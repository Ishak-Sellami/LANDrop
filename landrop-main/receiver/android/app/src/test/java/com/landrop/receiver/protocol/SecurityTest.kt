package com.landrop.receiver.protocol

// Phase 09 Security & Hardening — Kotlin mirror of sender/desktop/src/protocol/security.test.ts.
//
// NOTE: this file is a code-reviewed MIRROR. The JVM/Android toolchain is not
// available in this environment, so it has NOT been executed. Do not claim
// these tests pass anywhere. Run them via `./gradlew :app:testDebugUnitTest`
// once a JVM toolchain exists and record the result in the Phase 09 report.
//
// Mirrors what is executed in TypeScript (sender/desktop/src/protocol/security.test.ts):
//   1. V2/V3 delivery-state-machine pins.
//   2. Engine-level conformance battery along the receiver path: ok:intended-edge,
//      rejected: total rejection (event/to null, action None, state held).
//   3. Terminal-state seal of the engine (COMPLETED/REJECTED/FAILED/CANCELLED).
//   4. F-01 regression: side-effect leaks on rejected apply() are gone.
//   5. Wire-path metadata vectors (hostile package_name), duplicate-key
//      last-value-wins, JSON depth bombs, and frame-boundary fail-closed latch.

import java.nio.ByteBuffer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SecurityTest {
    private val sessionId = SessionId("sess_01JTEST")
    private val requestId = RequestId("req_01JTEST")
    private val transferId = TransferId("tr_01JTEST")
    private val declaredSize = 26_004_608L
    private val sha = Sha256("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")

    private fun request() = DeliveryRequest(
        ProtocolVersion(1),
        requestId,
        sessionId,
        Presentation(PresentationMode.GUI),
        SenderProfile("ISHAQ CYBERTECH"),
        ApplicationMetadata(
            ApkIdentity("com.example.application", declaredSize, sha),
            ApplicationPresentation("My Application", "1.4.2", "A local test application."),
        ),
    )

    private fun engine(initial: DeliveryState = DeliveryState.SESSION_ESTABLISHED) =
        DeliveryEngine(sessionId, initial)

    // --- machine pins -------------------------------------------------------

    @Test
    fun machineV2PinsVerifyingCannotReachInstallation() {
        val prohibited = listOf(
            DeliveryState.VERIFYING to DeliveryEvent.INSTALL_PREPARED,
            DeliveryState.VERIFYING to DeliveryEvent.HANDOFF_INITIATED,
            DeliveryState.VERIFYING to DeliveryEvent.COMPLETED,
        )
        for ((from, event) in prohibited) {
            assertTrue(
                "V2 pin violated: $from + $event",
                DeliveryStateMachine.transition(from, event) is DeliveryTransition.Rejected,
            )
        }
    }

    @Test
    fun machineV3PinsTransferringCannotReachInstallation() {
        val prohibited = listOf(
            DeliveryState.TRANSFERRING to DeliveryEvent.INSTALL_PREPARED,
            DeliveryState.TRANSFERRING to DeliveryEvent.HANDOFF_INITIATED,
            DeliveryState.TRANSFERRING to DeliveryEvent.COMPLETED,
        )
        for ((from, event) in prohibited) {
            assertTrue(
                "V3 pin violated: $from + $event",
                DeliveryStateMachine.transition(from, event) is DeliveryTransition.Rejected,
            )
        }
    }

    // --- engine conformance battery -----------------------------------------

    private fun assertConformant(before: DeliveryState, outcome: DeliveryOutcome) {
        if (!outcome.ok) {
            assertNull("total rejection leaks an event", outcome.event)
            assertNull("total rejection leaks a state", outcome.to)
            assertEquals("total rejection leaks a side-effect", DeliveryAction.None, outcome.action)
            assertTrue("rejection must carry a problem", outcome.problem != null)
            return
        }
        val event = outcome.event
        if (event != null) {
            val expected = DeliveryStateMachine.transition(before, event)
            assertEquals(
                "edge violation: $before + $event -> ${outcome.to}",
                expected,
                DeliveryTransition.Accepted(outcome.to),
            )
        } else {
            // observation/no-op op that does not move the machine
            assertEquals(before, outcome.to)
        }
    }

    @Test
    fun engineConformanceAlongReceiverPath() {
        val e = engine()
        var before = e.state

        var outcome = e.receiveIncomingRequest(request())
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.REQUEST_SENT, before)

        outcome = e.awaitDecision()
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.WAITING_FOR_DECISION, before)

        outcome = e.sendDecision(Decision.ACCEPT)
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.ACCEPTED, before)

        outcome = e.prepareTransfer()
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.TRANSFER_PREPARING, before)

        outcome = e.beginTransfer(transferId)
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.TRANSFERRING, before)

        // recordBytes is a progress observation, not a machine event
        outcome = e.recordBytes(1024)
        assertTrue(outcome.ok)
        assertConformant(before, outcome)
        assertEquals(DeliveryState.TRANSFERRING, e.state)

        outcome = e.completeTransfer()
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.VERIFYING, before)

        outcome = e.completeVerification(sha.value)
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.VERIFIED, before)

        outcome = e.prepareInstall()
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.INSTALL_READY, before)

        outcome = e.handoffInstall()
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.INSTALLATION_HANDOFF, before)

        outcome = e.installationCompleted()
        assertTrue(outcome.ok)
        assertConformant(before, outcome); before = outcome.to
        assertEquals(DeliveryState.COMPLETED, before)
    }

    private fun terminalStateBattery(initial: DeliveryState) {
        val e = engine(initial)
        val before = e.state
        val ops = listOf(
            { e.registerDeliveryRequest(request()) },
            { e.awaitDecision() },
            { e.receiveIncomingRequest(request()) },
            { e.sendDecision(Decision.ACCEPT) },
            { e.expire() },
            { e.prepareTransfer() },
            { e.beginTransfer(transferId) },
            { e.recordBytes(1) },
            { e.completeTransfer() },
            { e.completeVerification(sha.value) },
            { e.prepareInstall() },
            { e.handoffInstall() },
            { e.installationCompleted() },
            { e.installationUnavailable() },
            { e.cancel() },
            { e.processTransferCancel(transferId) },
            { e.transferTimeout() },
            { e.connectionLost() },
        )
        for (op in ops) {
            val outcome = op()
            assertFalse("terminal state $initial must reject", outcome.ok)
            assertConformant(before, outcome)
        }
        assertEquals("terminal state must be held", initial, e.state)
    }

    @Test
    fun terminalStatesSealTheEngine() {
        for (terminal in DeliveryStateMachine.terminalStates) terminalStateBattery(terminal)
    }

    // --- F-01 regression: no side-effect leak on rejection ------------------

    private fun acceptedEngine(): DeliveryEngine {
        val e = engine()
        assertTrue(e.receiveIncomingRequest(request()).ok)
        assertTrue(e.awaitDecision().ok)
        assertTrue(e.sendDecision(Decision.ACCEPT).ok)
        assertEquals(DeliveryState.ACCEPTED, e.state)
        return e
    }

    @Test
    fun rejectedExpireLeaksNoSideEffect() {
        val e = acceptedEngine()
        val outcome = e.expire()
        assertFalse(outcome.ok)
        assertEquals(DeliveryAction.None, outcome.action)
        assertEquals(DeliveryState.ACCEPTED, e.state)
    }

    @Test
    fun rejectedConnectionLostLeaksNoSideEffect() {
        val e = engine(DeliveryState.DISCOVERING)
        val outcome = e.connectionLost()
        assertFalse(outcome.ok)
        assertEquals(DeliveryAction.None, outcome.action)
        assertEquals(DeliveryState.DISCOVERING, e.state)
    }

    @Test
    fun rejectedProcessTransferCancelLeaksNoSideEffect() {
        val e = engine(DeliveryState.REQUEST_SENT)
        val outcome = e.processTransferCancel(transferId)
        assertFalse(outcome.ok)
        assertEquals(DeliveryAction.None, outcome.action)
        assertEquals(DeliveryState.REQUEST_SENT, e.state)
    }

    @Test
    fun rejectedInstallationUnavailableAndTimeoutLeakNoSideEffect() {
        val e = acceptedEngine()
        val unavailable = e.installationUnavailable()
        assertFalse(unavailable.ok)
        assertEquals(DeliveryAction.None, unavailable.action)
        assertEquals(DeliveryState.ACCEPTED, e.state)

        val timeout = e.transferTimeout()
        assertFalse(timeout.ok)
        assertEquals(DeliveryAction.None, timeout.action)
        assertEquals(DeliveryState.ACCEPTED, e.state)
    }

    // --- wire-path vectors --------------------------------------------------

    private fun canonicalRequestJson(): String {
        val encoded = ProtocolJson.encode(request())
        assertTrue("encode must succeed", encoded.isSuccess)
        return encoded.getOrThrow()
    }

    @Test
    fun metadataPathVectors() {
        val accepted = listOf("com.example.application")
        val hostile = listOf(
            "../../evil.apk",
            "/data/local/tmp/evil.apk",
            "C:\\\\evil.apk",
            "%2e%2e%2fevil.apk",
            "..",
            "com/example/application",
            "com.example.application:evil",
        )
        val canonical = canonicalRequestJson()
        for (name in accepted) {
            val patched = canonical.replace("\"package_name\":\"com.example.application\"", "\"package_name\":\"$name\"")
            assertTrue("expected accepted: $name", ProtocolJson.decode(patched).isSuccess)
        }
        for (name in hostile) {
            val patched = canonical.replace("\"package_name\":\"com.example.application\"", "\"package_name\":\"$name\"")
            assertFalse("path traversal must be rejected: $name", ProtocolJson.decode(patched).isSuccess)
        }
    }

    @Test
    fun duplicateKeysAreLastValueWins() {
        val baseline = ProtocolJson.decode(canonicalRequestJson()).getOrThrow()

        fun assertLastValueWins(label: String, injectedPrefix: String, originalNeedle: String, canonical: String) {
            val text = canonical.replaceFirst(originalNeedle, "$injectedPrefix$originalNeedle")
            val decoded = ProtocolJson.decode(text)
            assertTrue("$label must decode", decoded.isSuccess)
            assertEquals("$label must be last-value-wins", baseline, decoded.getOrThrow())
        }

        val canonical = canonicalRequestJson()
        assertLastValueWins(
            "duplicate type",
            "\"type\":\"error\",",
            "\"type\":\"delivery_request\"",
            canonical,
        )
        assertLastValueWins(
            "duplicate protocol_version",
            "\"protocol_version\":2,",
            "\"protocol_version\":1",
            canonical,
        )
        assertLastValueWins(
            "duplicate hostile package_name",
            "\"package_name\":\"../../evil.apk\",",
            "\"package_name\":\"com.example.application\"",
            canonical,
        )
    }

    @Test
    fun deepJsonIsRejected() {
        fun depthBomb(levels: Int): String {
            val open = "{\"a\":".repeat(levels)
            return open + "0" + "}".repeat(levels)
        }
        for (levels in listOf(17, 32, 64, 1024)) {
            val decoded = ProtocolJson.decode(depthBomb(levels))
            assertFalse("depth $levels must be rejected", decoded.isSuccess)
        }
    }

    // --- frame-boundary fail-closed latch -----------------------------------

    private fun lengthHeader(length: Int): ByteArray =
        ByteBuffer.allocate(4).putInt(length).array()

    @Test
    fun frameBoundaryAtLimitIsIncomplete() {
        val stream = JsonMessageStream()
        stream.feed(lengthHeader(MAX_FRAME_PAYLOAD_BYTES))
        assertTrue(stream.readMessage() is JsonMessageResult.Incomplete)
    }

    @Test
    fun frameBoundaryOverLimitLatchesClosed() {
        val stream = JsonMessageStream()
        stream.feed(lengthHeader(MAX_FRAME_PAYLOAD_BYTES + 1))
        val first = stream.readMessage()
        assertTrue("over-limit must be a frame error", first is JsonMessageResult.FrameError)
        assertEquals(FrameProblem.FRAME_TOO_LARGE, (first as JsonMessageResult.FrameError).problem)

        // fail-closed: a perfectly valid frame afterwards is still refused
        val encoded = encodeJsonFrame(createDeliveryResponse(requestId, Decision.ACCEPT))
        assertTrue("control encode must succeed", encoded is JsonFrameEncodeResult.Ok)
        val bytes = (encoded as JsonFrameEncodeResult.Ok).bytes
        stream.feed(lengthHeader(bytes.size))
        stream.feed(bytes)
        val second = stream.readMessage()
        assertTrue("decoder must stay latched after overflow", second is JsonMessageResult.FrameError)
        assertEquals(FrameProblem.FRAME_TOO_LARGE, (second as JsonMessageResult.FrameError).problem)
    }

    @Test
    fun frameBoundaryZeroLengthIsNotAMessage() {
        val stream = JsonMessageStream()
        stream.feed(lengthHeader(0))
        val result = stream.readMessage()
        assertTrue("zero-length frame must not yield a message", result !is JsonMessageResult.Message)
    }
}