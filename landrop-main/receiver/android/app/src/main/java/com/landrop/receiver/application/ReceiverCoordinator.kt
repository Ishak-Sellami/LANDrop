package com.landrop.receiver.application

import com.landrop.receiver.protocol.ControlMessage
import com.landrop.receiver.protocol.Decision
import com.landrop.receiver.protocol.DeliveryAction
import com.landrop.receiver.protocol.DeliveryEngine
import com.landrop.receiver.protocol.DeliveryOutcome
import com.landrop.receiver.protocol.DeliveryProblem
import com.landrop.receiver.protocol.DeliveryRequest
import com.landrop.receiver.protocol.DeliveryResponse
import com.landrop.receiver.protocol.DeliveryState
import com.landrop.receiver.protocol.ErrorMessage
import com.landrop.receiver.protocol.JsonFrameEncodeResult
import com.landrop.receiver.protocol.JsonMessageResult
import com.landrop.receiver.protocol.JsonMessageStream
import com.landrop.receiver.protocol.SessionId
import com.landrop.receiver.protocol.TransferCancel
import com.landrop.receiver.protocol.TransferId
import com.landrop.receiver.protocol.TransferProgress
import com.landrop.receiver.protocol.encodeJsonFrame

// Receiver application-layer seam (integration boundary between the protocol
// layer and the Android host). Before Phase 08 the Android app layer only
// rendered a static screen; this coordinator is the missing connection: it
// feeds transport bytes into the Phase 02/06 message boundary, routes control
// messages into the frozen Phase 03 DeliveryEngine, switches to the binary
// transfer plane (protocol spec §17) after an ACCEPT decision, enforces the
// declared size (§18), computes the SHA-256 digest via the platform seam (§20),
// routes verification through the engine (§21), and hands the verified
// artifact to the platform installer seam (§23).
//
// Mirrors the Sender's application-layer service and the over-the-wire harness
// in delivery-flow.test.ts (sender side). Parity is exact for the ordered
// engine op sequence; the local transfer-id factory differs by design (see
// the recorded spec gaps below).
//
// Design rules honored:
// - No second state machine: the DeliveryEngine owns ALL delivery state.
//   `observer` is an observability hook only; nothing reads it back into the
//   machine.
// - No invented wire messages and no invented state transitions: every action
//   comes from the engine; this class only executes send_message for control
//   frames (via encodeJsonFrame) and observes begin/stop/install/cleanup.
// - Plain JVM (no android.*, no java.time): unit-testable without a device.
// - User consent is preserved: an ACCEPT decision only happens through
//   userDecision(), called by the app layer; nothing fabricates a consent.
//
// Recorded specification gaps (documented, not worked around):
// - transfer_id has no wire carrier (protocol §17-§19), so the Receiver cannot
//   learn the Sender's transfer id. This coordinator assigns its own local
//   TransferId when the artifact starts arriving; an inbound Sender-originated
//   transfer_cancel therefore cannot be correlated with the active transfer
//   (engine answers TRANSFER_ID_MISMATCH and the transfer continues). That is
//   the honest behavior of the frozen protocol; a future phase may define a
//   wire carrier only if the spec does.
// - The binary APK plane has no byte-level framing markers: the coordinator
//   enters binary mode the moment an ACCEPT decision is sent and counts bytes
//   against the engine; completion is byte-count based (declared size).
// - Verification / installation results have no wire feedback message; the
//   Sender mirror completes through the same deterministic ops (see the
//   Sender-side service).
class ReceiverCoordinator(
    val sessionId: SessionId,
    private val store: ArtifactStore,
    private val hashArtifact: (OwnedArtifact) -> String,
    private val installer: DeliveryInstaller,
    private val localTransferIdFactory: (Int) -> TransferId = { n -> TransferId("transfer_local_$n") },
) {
    val engine = DeliveryEngine(sessionId)

    private val messageStream = JsonMessageStream()
    private val outbound = mutableListOf<ByteArray>()
    private var binaryMode = false
    private var transferCounter = 0

    /** Observability hook for the UI/diagnostics (NOT a delivery state). */
    var observer: (String) -> Unit = {}

    val outboundFrames: List<ByteArray> get() = outbound.toList()

    val awaitingConsent: Boolean get() = engine.state == DeliveryState.WAITING_FOR_DECISION

    // --- Transport feed -------------------------------------------------------

    /** Feed one chunk from the transport (control plane or binary plane). */
    fun onBytes(chunk: ByteArray) {
        if (binaryMode) {
            receiveBinary(chunk)
            return
        }
        messageStream.feed(chunk)
        dispatchControl()
    }

    // --- Consent (application layer; nothing fabricates it) -------------------

    fun userDecision(decision: Decision): DeliveryOutcome {
        val outcome = engine.sendDecision(decision)
        if (outcome.ok) recordAction(outcome)
        // Spec §17: after ACCEPT the Sender starts the binary artifact plane.
        if (outcome.ok && decision == Decision.ACCEPT) binaryMode = true
        return outcome
    }

    // --- Local lifecycle triggers ----------------------------------------------

    fun cancelLocal(): DeliveryOutcome {
        val outcome = engine.cancel()
        if (outcome.ok) {
            recordAction(outcome)
            store.delete()
        }
        return outcome
    }

    fun onConnectionLost(): DeliveryOutcome {
        val outcome = engine.connectionLost()
        if (outcome.ok) {
            recordAction(outcome)
            store.delete()
        }
        return outcome
    }

    fun onExpiry(): DeliveryOutcome {
        val outcome = engine.expire()
        if (outcome.ok) {
            recordAction(outcome)
            store.delete()
        }
        return outcome
    }

    // --- Control plane ----------------------------------------------------------

    private fun dispatchControl() {
        while (true) {
            when (val result = messageStream.readMessage()) {
                is JsonMessageResult.Message -> handleControl(result.message)
                JsonMessageResult.Incomplete -> return
                is JsonMessageResult.FrameError -> {
                    observer("protocol_error: bad frame")
                    return
                }
                is JsonMessageResult.ProtocolError -> {
                    observer("protocol_error: invalid message")
                    return
                }
            }
        }
    }

    private fun handleControl(message: ControlMessage) {
        when (message) {
            is DeliveryRequest -> {
                val received = engine.receiveIncomingRequest(message)
                if (received.ok && engine.awaitDecision().ok) {
                    observer("request_received_awaiting_consent")
                } else {
                    observer("request_rejected: ${received.problem}")
                }
            }
            is DeliveryResponse -> observer("unexpected_delivery_response")
            is ErrorMessage -> observer("peer_error: ${message.code}")
            is TransferProgress -> {
                // Progress is observation (§31), never a state change.
                observer("progress_observation")
            }
            is TransferCancel -> {
                // The Sender's transfer_id is unknown here (spec gap); the
                // engine rejects on mismatch and the transfer continues.
                val outcome = engine.processTransferCancel(message.transferId)
                if (outcome.ok) {
                    recordAction(outcome)
                    store.delete()
                    binaryMode = false
                    observer("transfer_cancelled")
                } else {
                    observer("transfer_cancel_unroutable: ${outcome.problem}")
                }
            }
        }
    }

    // --- Binary plane (spec §17-§18) ---------------------------------------------

    private fun receiveBinary(chunk: ByteArray) {
        when (engine.state) {
            DeliveryState.ACCEPTED -> {
                val prepared = engine.prepareTransfer()
                if (!prepared.ok) {
                    observer("prepare_transfer_error: ${prepared.problem}")
                    return
                }
                startTransferAndAppend(chunk)
            }
            DeliveryState.TRANSFER_PREPARING -> startTransferAndAppend(chunk)
            DeliveryState.TRANSFERRING -> appendChunk(chunk)
            else -> observer("unexpected_binary_bytes")
        }
    }

    private fun startTransferAndAppend(chunk: ByteArray) {
        val begun = engine.beginTransfer(localTransferIdFactory(++transferCounter))
        if (!begun.ok) {
            observer("begin_transfer_error: ${begun.problem}")
            return
        }
        recordAction(begun)
        if (store.begin(engine.declaredSize).isFailure) {
            observer("store_error")
            store.delete()
            binaryMode = false
            return
        }
        appendChunk(chunk)
    }

    private fun appendChunk(chunk: ByteArray) {
        if (chunk.isEmpty()) return
        val recorded = engine.recordBytes(chunk.size.toLong())
        if (!recorded.ok) {
            observer("size_enforcement: ${recorded.problem}")
            store.delete()
            binaryMode = false
            return
        }
        if (store.append(chunk).isFailure) {
            observer("store_error")
            store.delete()
            binaryMode = false
            return
        }
        if (engine.bytesTransferredCount == engine.declaredSize) finishTransferAndVerify()
    }

    // --- Verification + installation handoff (spec §20-§23) ----------------------

    private fun finishTransferAndVerify() {
        val completed = engine.completeTransfer()
        if (!completed.ok) {
            observer("complete_transfer_error: ${completed.problem}")
            store.delete()
            return
        }
        observer("verifying")
        val artifact = store.finish().getOrElse {
            observer("seal_error")
            store.delete()
            return
        }
        val verified = engine.completeVerification(hashArtifact(artifact))
        when {
            verified.ok -> afterVerified(artifact)
            verified.problem == DeliveryProblem.INTEGRITY_MISMATCH -> {
                observer("integrity_mismatch_install_blocked")
                store.delete()
            }
            else -> {
                observer("verification_error: ${verified.problem}")
                store.delete()
            }
        }
    }

    private fun afterVerified(artifact: OwnedArtifact) {
        observer("verified")
        if (!engine.prepareInstall().ok) return
        val handoff = engine.handoffInstall()
        if (!handoff.ok) return
        recordAction(handoff)
        when (val outcome = installer.install(artifact)) {
            InstallOutcome.Succeeded -> {
                val done = engine.installationCompleted()
                if (done.ok) {
                    recordAction(done)
                    store.delete()
                    observer("completed")
                }
            }
            InstallOutcome.Unavailable -> {
                val done = engine.installationUnavailable()
                if (done.ok) {
                    recordAction(done)
                    store.delete()
                    observer("installation_unavailable")
                }
            }
        }
    }

    // --- Action execution (the engine emits instructions; this class executes) ---

    private fun recordAction(outcome: DeliveryOutcome) {
        when (val action = outcome.action) {
            is DeliveryAction.SendMessage -> {
                when (val encoded = encodeJsonFrame(action.message)) {
                    is JsonFrameEncodeResult.Ok -> outbound.add(encoded.bytes)
                    is JsonFrameEncodeResult.Failing -> observer("encode_error")
                }
            }
            DeliveryAction.BeginStream -> observer("begin_stream")
            DeliveryAction.StopStream -> observer("stop_stream")
            DeliveryAction.InvokeInstaller -> observer("invoke_installer")
            DeliveryAction.Cleanup -> observer("cleanup")
            DeliveryAction.None -> Unit
        }
    }
}