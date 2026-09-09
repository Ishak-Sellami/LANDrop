package com.landrop.receiver.application

import com.landrop.receiver.protocol.ApplicationMetadata
import com.landrop.receiver.protocol.ApkIdentity
import com.landrop.receiver.protocol.ApplicationPresentation
import com.landrop.receiver.protocol.Decision
import com.landrop.receiver.protocol.DeliveryRequest
import com.landrop.receiver.protocol.DeliveryResponse
import com.landrop.receiver.protocol.DeliveryState
import com.landrop.receiver.protocol.JsonFrameEncodeResult
import com.landrop.receiver.protocol.JsonMessageResult
import com.landrop.receiver.protocol.JsonMessageStream
import com.landrop.receiver.protocol.Presentation
import com.landrop.receiver.protocol.PresentationMode
import com.landrop.receiver.protocol.ProtocolVersion
import com.landrop.receiver.protocol.RequestId
import com.landrop.receiver.protocol.SenderProfile
import com.landrop.receiver.protocol.SessionId
import com.landrop.receiver.protocol.Sha256
import com.landrop.receiver.protocol.encodeJsonFrame
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.MessageDigest

// Phase 08 — ReceiverCoordinator mirror (JVM, unexecuted in this environment:
// no Kotlin/Android toolchain is installed). Mirrors the TypeScript scenario
// suite sender/desktop/src/application/lanDropDesktop.test.ts scenario-for-
// scenario. The coordinator consumes raw frame bytes via onBytes() exactly as
// the future Android transport seam would feed decoded/raw bytes from the wire.
//
// Recorded spec gaps surfaced by these tests (not worked around):
// - transfer_id has no wire carrier, so the coordinator assigns its own local
//   TransferId; the Sender's transfer_cancel cannot be demuxed out of the
//   binary plane (it has no framing markers). See the cancellation test.
// - Verification/installation results have no wire feedback message; the
//   Sender mirror completes through the same deterministic ops.
class ReceiverCoordinatorTest {

    private val sessionId = SessionId("sess_08INTEG")
    private val requestId = RequestId("req_08INTEG")
    private val artifactText = "LanDrop-phase-08"
    private val artifact = artifactText.toByteArray(Charsets.UTF_8)
    private val declaredSha = Sha256(sha256Hex(artifact))

    private fun request(size: Long = artifact.size.toLong(), sha: Sha256 = declaredSha) = DeliveryRequest(
        ProtocolVersion(1),
        requestId,
        sessionId,
        Presentation(PresentationMode.GUI),
        SenderProfile("ISHAQ CYBERTECH"),
        ApplicationMetadata(
            ApkIdentity("com.example.application", size, sha),
            ApplicationPresentation("IntegTest", "1.0.0", "Phase 08 integration scenario."),
        ),
    )

    private class RecordingInstaller : DeliveryInstaller {
        var installCalls = 0
        var outcome: InstallOutcome = InstallOutcome.Succeeded
        override fun install(artifact: OwnedArtifact): InstallOutcome {
            installCalls += 1
            return outcome
        }
    }

    private class InMemoryArtifactStore(override val sessionId: SessionId) : ArtifactStore {
        var bytes: ByteArray = ByteArray(0)
        private var expected = 0L
        var deleted = false

        override fun begin(expectedSizeBytes: Long): Result<Unit> {
            expected = expectedSizeBytes
            bytes = ByteArray(0)
            return Result.success(Unit)
        }

        override fun append(chunk: ByteArray): Result<Unit> {
            if (bytes.size.toLong() + chunk.size > expected) {
                return Result.failure(IllegalStateException("artifact exceeds declared size"))
            }
            bytes = bytes + chunk
            return Result.success(Unit)
        }

        override fun finish(): Result<OwnedArtifact> {
            if (bytes.size.toLong() != expected) {
                return Result.failure(IllegalStateException("artifact size mismatch"))
            }
            return Result.success(OwnedArtifact(ArtifactPath.relative(sessionId), bytes.size.toLong()))
        }

        override fun delete() {
            deleted = true
        }
    }

    private fun sha256Hex(bytes: ByteArray): String =
        MessageDigest.getInstance("SHA-256").digest(bytes)
            .joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }

    private fun encodedFrame(message: com.landrop.receiver.protocol.ControlMessage): ByteArray =
        when (val result = encodeJsonFrame(message)) {
            is JsonFrameEncodeResult.Ok -> result.bytes
            is JsonFrameEncodeResult.Failing -> error("encode failed")
        }

    private fun build(
        store: InMemoryArtifactStore = InMemoryArtifactStore(sessionId),
        installer: RecordingInstaller = RecordingInstaller(),
        request: DeliveryRequest = request(),
    ): Triple<ReceiverCoordinator, InMemoryArtifactStore, RecordingInstaller> {
        val coordinator = ReceiverCoordinator(
            sessionId = sessionId,
            store = store,
            hashArtifact = { sha256Hex(store.bytes) },
            installer = installer,
        )
        coordinator.onBytes(encodedFrame(request))
        return Triple(coordinator, store, installer)
    }

    @Test
    fun onWireRequestReachesAwaitingConsent() {
        val (coordinator, _, _) = build()
        assertTrue(coordinator.awaitingConsent)
        assertEquals(DeliveryState.WAITING_FOR_DECISION, coordinator.engine.state)
    }

    @Test
    fun fullLifecycleAcceptTransferVerifyInstallCompletes() {
        val (coordinator, store, installer) = build()
        coordinator.userDecision(Decision.ACCEPT)
        assertEquals(1, coordinator.outboundFrames.size)

        val stream = JsonMessageStream()
        stream.feed(coordinator.outboundFrames[0])
        val decoded = stream.readMessage()
        assertTrue(decoded is JsonMessageResult.Message)
        assertEquals(
            DeliveryResponse(requestId, Decision.ACCEPT),
            (decoded as JsonMessageResult.Message).message,
        )

        // Binary plane: three chunks ([7,1,8] as in the TS fixture).
        val observations = mutableListOf<String>()
        coordinator.observer = { observations.add(it) }
        coordinator.onBytes(artifact.copyOfRange(0, 7))
        coordinator.onBytes(artifact.copyOfRange(7, 8))
        coordinator.onBytes(artifact.copyOfRange(8, 16))

        assertEquals(DeliveryState.COMPLETED, coordinator.engine.state)
        assertEquals(1, installer.installCalls)
        assertTrue(store.deleted)
        assertTrue(observations.contains("verifying"))
        assertTrue(observations.contains("verified"))
        assertTrue(observations.contains("invoke_installer"))
        assertTrue(observations.contains("completed"))
    }

    @Test
    fun tamperedArtifactBlocksInstallAndCleansUp() {
        val (coordinator, store, installer) = build()
        coordinator.userDecision(Decision.ACCEPT)

        val tampered = artifact.copyOf()
        tampered[6] = (tampered[6].toInt() xor 0xff).toByte()
        val observations = mutableListOf<String>()
        coordinator.observer = { observations.add(it) }
        coordinator.onBytes(tampered)

        assertEquals(DeliveryState.FAILED, coordinator.engine.state)
        assertEquals(0, installer.installCalls)
        assertTrue(store.deleted)
        assertTrue(observations.contains("integrity_mismatch_install_blocked"))
    }

    @Test
    fun rejectedRequestReachesRejectedWithNoTransfer() {
        val (coordinator, store, installer) = build()
        coordinator.userDecision(Decision.REJECT)

        assertEquals(DeliveryState.REJECTED, coordinator.engine.state)
        assertEquals(1, coordinator.outboundFrames.size)
        assertEquals(0, installer.installCalls)
        assertFalse(store.deleted)
    }

    @Test
    fun connectionLossMidTransferFailsAndCleans() {
        val (coordinator, store, installer) = build()
        coordinator.userDecision(Decision.ACCEPT)
        coordinator.onBytes(artifact.copyOfRange(0, 8))
        assertEquals(DeliveryState.TRANSFERRING, coordinator.engine.state)

        coordinator.onConnectionLost()
        assertEquals(DeliveryState.FAILED, coordinator.engine.state)
        assertEquals(0, installer.installCalls)
        assertTrue(store.deleted)
    }

    @Test
    fun localCancelMidTransferCancelsAndCleans() {
        // Mirror of the TS sender-cancellation scenario: the Sender cancels
        // locally (its engine reaches CANCELLED) while the Receiver aborts.
        val (coordinator, store, installer) = build()
        coordinator.userDecision(Decision.ACCEPT)
        coordinator.onBytes(artifact.copyOfRange(0, 6))
        assertEquals(DeliveryState.TRANSFERRING, coordinator.engine.state)

        coordinator.cancelLocal()
        assertEquals(DeliveryState.CANCELLED, coordinator.engine.state)
        assertEquals(0, installer.installCalls)
        assertTrue(store.deleted)
    }

    @Test
    fun installUnavailableRoutesToFailureAndCleans() {
        val installer = RecordingInstaller().apply { outcome = InstallOutcome.Unavailable }
        val (coordinator, store, _) = build(installer = installer)
        coordinator.userDecision(Decision.ACCEPT)
        val observations = mutableListOf<String>()
        coordinator.observer = { observations.add(it) }
        coordinator.onBytes(artifact)

        assertEquals(DeliveryState.FAILED, coordinator.engine.state)
        assertEquals(1, installer.installCalls)
        assertTrue(observations.contains("installation_unavailable"))
        assertTrue(store.deleted)
    }
}