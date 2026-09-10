package com.landrop.receiver.protocol

// Delivery Engine — deterministic delivery-request, transfer-flow, integrity-
// verification, and installation-handoff orchestration (protocol spec §8-§26,
// project spec §12-§19, architecture §18, §21). Pure decision logic only:
// validates input, checks the frozen Phase 03 Delivery State Machine, computes
// the event + next state, and emits a side-effect instruction. No I/O, no
// storage, no hashing, and no installation work (protocol spec §20-§23 gate
// VERIFYING -> INSTALLATION_HANDOFF; the digest is computed by the platform
// seam and handed in, and the installer is invoked by the application layer).
//
// Mirrors sender/desktop/src/protocol/delivery.ts and the Rust mirror
// sender/desktop/src-tauri/src/protocol/delivery.rs.

// Local decision-layer diagnostics, never wire ErrorCodes.
enum class DeliveryProblem {
    INVALID_STATE,
    INVALID_TRANSITION,
    NO_REQUEST,
    NO_TRANSFER,
    REQUEST_MISMATCH,
    RESPONSE_MISMATCH,
    TRANSFER_ID_MISMATCH,
    INVALID_TRANSFER_ID,
    INVALID_BYTES,
    SIZE_EXCEEDED,
    SIZE_MISMATCH,
    SIZE_VALIDATION_FAILED,
    INVALID_DIGEST,
    NO_DIGEST,
    INTEGRITY_MISMATCH,
}

// Side-effect instruction executed by the application layer; this module never
// performs I/O.
sealed interface DeliveryAction {
    data object None : DeliveryAction
    data class SendMessage(val message: ControlMessage) : DeliveryAction
    data object BeginStream : DeliveryAction
    data object StopStream : DeliveryAction
    data object InvokeInstaller : DeliveryAction
    data object Cleanup : DeliveryAction
}

data class DeliveryOutcome(
    val ok: Boolean,
    val event: DeliveryEvent?,
    val to: DeliveryState?,
    val action: DeliveryAction,
    val problem: DeliveryProblem?,
)

fun outcomeProblem(problem: DeliveryProblem): DeliveryOutcome =
    DeliveryOutcome(ok = false, event = null, to = null, action = DeliveryAction.None, problem = problem)

fun decisionEvent(decision: Decision): DeliveryEvent = when (decision) {
    Decision.ACCEPT -> DeliveryEvent.ACCEPTED
    Decision.REJECT -> DeliveryEvent.REJECTED
}

fun createDeliveryResponse(requestId: RequestId, decision: Decision): DeliveryResponse =
    DeliveryResponse(requestId, decision)

/// Clamped percentage (0..100). Progress is observation, not a Delivery State
/// (protocol spec §31): the machine stays in TRANSFERRING.
fun calculateTransferProgress(bytesTransferred: Long, totalBytes: Long): Long {
    if (totalBytes <= 0) return 0
    val pct = bytesTransferred.coerceAtLeast(0) * 100 / totalBytes
    return pct.coerceIn(0, 100)
}

// Defense-in-depth parity with the TypeScript engine, which validates the raw
// string at beginTransfer. The TransferId value class already enforces this.
private val transferIdPattern = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")

class DeliveryEngine(
    private val sessionId: SessionId,
    initialState: DeliveryState = DeliveryState.SESSION_ESTABLISHED,
) {
    var state: DeliveryState = initialState
        private set
    var request: DeliveryRequest? = null
        private set
    var transferId: TransferId? = null
        private set

    private var bytesTransferred: Long = 0

    val declaredSize: Long get() = request?.application?.identity?.sizeBytes ?: 0
    val expectedDigest: String?
        get() = request?.application?.identity?.sha256?.value
    val bytesTransferredCount: Long get() = bytesTransferred
    val progressPercent: Long get() = calculateTransferProgress(bytesTransferred, declaredSize)

    private fun requireNoTerminal(): DeliveryProblem? =
        if (DeliveryStateMachine.isDeliveryTerminal(state)) DeliveryProblem.INVALID_STATE else null

    private fun apply(event: DeliveryEvent, requestedState: DeliveryState): DeliveryOutcome {
        if (state != requestedState) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        return when (val result = DeliveryStateMachine.transition(state, event)) {
            is DeliveryTransition.Accepted -> {
                state = result.to
                DeliveryOutcome(
                    ok = true,
                    event = event,
                    to = result.to,
                    action = DeliveryAction.None,
                    problem = null,
                )
            }
            is DeliveryTransition.Rejected -> outcomeProblem(DeliveryProblem.INVALID_TRANSITION)
        }
    }

    private fun finish(inner: DeliveryOutcome, action: DeliveryAction): DeliveryOutcome =
        inner.copy(action = action)

    /** Sender: register and send a delivery request (spec §8-§13). */
    fun registerDeliveryRequest(request: DeliveryRequest): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.SESSION_ESTABLISHED) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        if (request.sessionId != sessionId) return outcomeProblem(DeliveryProblem.REQUEST_MISMATCH)
        this.request = request
        bytesTransferred = 0
        val applied = apply(DeliveryEvent.REQUEST_SENT, DeliveryState.SESSION_ESTABLISHED)
        return finish(applied, DeliveryAction.SendMessage(request))
    }

    /** Sender: request is on the wire; wait for the Receiver decision. */
    fun awaitDecision(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        return apply(DeliveryEvent.AWAITING_DECISION, DeliveryState.REQUEST_SENT)
    }

    /** Receiver: validate an incoming delivery request (spec §35-§37). */
    fun receiveIncomingRequest(request: DeliveryRequest): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.SESSION_ESTABLISHED) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        if (request.sessionId != sessionId) return outcomeProblem(DeliveryProblem.REQUEST_MISMATCH)
        this.request = request
        bytesTransferred = 0
        // Mirror of the Sender's machine advance: request present -> awaiting user.
        val applied = apply(DeliveryEvent.REQUEST_SENT, DeliveryState.SESSION_ESTABLISHED)
        return finish(applied, DeliveryAction.None)
    }

    /** Receiver: send the decision (spec §10, §14-§15). */
    fun sendDecision(decision: Decision): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.WAITING_FOR_DECISION) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val activeRequest = request ?: return outcomeProblem(DeliveryProblem.NO_REQUEST)
        val applied = apply(decisionEvent(decision), DeliveryState.WAITING_FOR_DECISION)
        // Spec §14-§15: the Receiver sends delivery_response for BOTH decisions.
        return finish(
            applied,
            DeliveryAction.SendMessage(createDeliveryResponse(activeRequest.requestId, decision)),
        )
    }

    /** Sender: process the Receiver's response. */
    fun processResponse(response: DeliveryResponse): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.WAITING_FOR_DECISION) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val activeRequest = request ?: return outcomeProblem(DeliveryProblem.NO_REQUEST)
        if (response.requestId != activeRequest.requestId) return outcomeProblem(DeliveryProblem.RESPONSE_MISMATCH)
        return apply(decisionEvent(response.decision), DeliveryState.WAITING_FOR_DECISION)
    }

    /** Expiration (spec §25; the numeric timeout is a recorded gap). */
    fun expire(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        // A rejected application must not emit a stale cleanup instruction.
        val applied = apply(DeliveryEvent.EXPIRED, DeliveryState.WAITING_FOR_DECISION)
        if (!applied.ok) return applied
        return finish(applied, DeliveryAction.Cleanup)
    }

    /** Transfer preparation (spec §16). */
    fun prepareTransfer(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.ACCEPTED) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val applied = apply(DeliveryEvent.TRANSFER_PREPARED, DeliveryState.ACCEPTED)
        return finish(applied, DeliveryAction.None)
    }

    /** Transfer start (spec §16-§17). */
    fun beginTransfer(id: TransferId): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.TRANSFER_PREPARING) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        if (request == null) return outcomeProblem(DeliveryProblem.NO_REQUEST)
        if (!transferIdPattern.matches(id.value)) return outcomeProblem(DeliveryProblem.INVALID_TRANSFER_ID)
        if (declaredSize <= 0) return outcomeProblem(DeliveryProblem.SIZE_VALIDATION_FAILED)
        transferId = id
        bytesTransferred = 0
        val applied = apply(DeliveryEvent.TRANSFER_STARTED, DeliveryState.TRANSFER_PREPARING)
        return finish(applied, DeliveryAction.BeginStream)
    }

    /** Byte accounting (spec §18 receiver-side size enforcement). */
    fun recordBytes(count: Long): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.TRANSFERRING) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        if (count <= 0) return outcomeProblem(DeliveryProblem.INVALID_BYTES)
        val next = bytesTransferred + count
        if (next > declaredSize) return outcomeProblem(DeliveryProblem.SIZE_EXCEEDED)
        bytesTransferred = next
        return DeliveryOutcome(ok = true, event = null, to = null, action = DeliveryAction.None, problem = null)
    }

    /** Transfer completion (spec §19-§20): stops at VERIFICATION_INITIATED. */
    fun completeTransfer(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.TRANSFERRING) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        if (transferId == null) return outcomeProblem(DeliveryProblem.NO_TRANSFER)
        if (bytesTransferred != declaredSize) return outcomeProblem(DeliveryProblem.SIZE_MISMATCH)
        val applied = apply(DeliveryEvent.VERIFICATION_INITIATED, DeliveryState.TRANSFERRING)
        return finish(applied, DeliveryAction.None)
    }

    /** Receiver: integrity verification (spec §20-§21). The application layer
     *  computes SHA-256 over the received artifact via the platform seam and
     *  hands the lowercase-hex digest in. The engine classifies it against the
     *  declared digest and routes through the frozen machine. */
    fun completeVerification(actualDigest: String): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.VERIFYING) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val request = request ?: return outcomeProblem(DeliveryProblem.NO_REQUEST)
        val expected = request.application.identity.sha256.value
        // Defensive (unreachable: Sha256 validates 64 hex chars at construction).
        if (expected.isEmpty()) return outcomeProblem(DeliveryProblem.NO_DIGEST)
        if (!Integrity.isValidSha256(actualDigest)) return outcomeProblem(DeliveryProblem.INVALID_DIGEST)
        return if (Integrity.hashesMatch(expected, actualDigest)) {
            val applied = apply(DeliveryEvent.VERIFIED, DeliveryState.VERIFYING)
            finish(applied, DeliveryAction.None)
        } else {
            // Protocol §21: mismatch -> FAILED, installation blocked, cleanup.
            val applied = apply(DeliveryEvent.INTEGRITY_MISMATCH, DeliveryState.VERIFYING)
            finish(applied, DeliveryAction.Cleanup).let {
                it.copy(problem = DeliveryProblem.INTEGRITY_MISMATCH)
            }
        }
    }

    /** Receiver: installation handoff (spec §23, project spec §26). */
    fun prepareInstall(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.VERIFIED) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val applied = apply(DeliveryEvent.INSTALL_PREPARED, DeliveryState.VERIFIED)
        return finish(applied, DeliveryAction.None)
    }

    /** The application layer calls this immediately before invoking the
     *  platform installer; the emitted instruction tells it exactly that. */
    fun handoffInstall(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.INSTALL_READY) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val applied = apply(DeliveryEvent.HANDOFF_INITIATED, DeliveryState.INSTALL_READY)
        return finish(applied, DeliveryAction.InvokeInstaller)
    }

    /** Called only when the platform's supported package-install mechanism has
     *  genuinely reported completion. Nothing fabricates this result. */
    fun installationCompleted(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.INSTALLATION_HANDOFF) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        // Terminal state -> cleanup instruction (artifact/session lifecycle).
        val applied = apply(DeliveryEvent.COMPLETED, DeliveryState.INSTALLATION_HANDOFF)
        return finish(applied, DeliveryAction.Cleanup)
    }

    /** Platform reports the package installer is unavailable, before or during
     *  handoff (project spec §24 INSTALLATION_UNAVAILABLE). */
    fun installationUnavailable(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.INSTALL_READY && state != DeliveryState.INSTALLATION_HANDOFF) {
            return outcomeProblem(DeliveryProblem.INVALID_STATE)
        }
        val applied = apply(DeliveryEvent.INSTALLATION_UNAVAILABLE, state)
        if (!applied.ok) return applied
        return finish(applied, DeliveryAction.Cleanup)
    }

    /** Cancellation (spec §24; machine-gated). */
    fun cancel(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        val applied = apply(DeliveryEvent.CANCELLED, state)
        if (!applied.ok) return applied
        return finish(applied, DeliveryAction.Cleanup)
    }

    /** Incoming transfer_cancel from the Sender (spec §24). */
    fun processTransferCancel(id: TransferId): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        val active = transferId ?: return outcomeProblem(DeliveryProblem.NO_TRANSFER)
        if (active != id) return outcomeProblem(DeliveryProblem.TRANSFER_ID_MISMATCH)
        val applied = apply(DeliveryEvent.CANCELLED, state)
        if (!applied.ok) return applied
        return finish(applied, DeliveryAction.StopStream)
    }

    /** Transfer inactivity timeout (spec §26). */
    fun transferTimeout(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        if (state != DeliveryState.TRANSFERRING) return outcomeProblem(DeliveryProblem.INVALID_STATE)
        val applied = apply(DeliveryEvent.TRANSFER_TIMED_OUT, DeliveryState.TRANSFERRING)
        if (!applied.ok) return applied
        return finish(applied, DeliveryAction.Cleanup)
    }

    /** Connection loss at any pre-terminal stage (spec §27). */
    fun connectionLost(): DeliveryOutcome {
        requireNoTerminal()?.let { return outcomeProblem(it) }
        val applied = apply(DeliveryEvent.CONNECTION_LOST, state)
        if (!applied.ok) return applied
        return finish(applied, DeliveryAction.Cleanup)
    }
}