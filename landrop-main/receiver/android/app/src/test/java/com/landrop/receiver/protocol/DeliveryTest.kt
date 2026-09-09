package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliveryTest {
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

    // Receives a request and advances to WAITING_FOR_DECISION (the receiver
    // happy-path ordering: receive_request -> await_decision -> decision).
    private fun awaitingDecision(): DeliveryEngine {
        val engine = engine()
        assertTrue(engine.receiveIncomingRequest(request()).ok)
        assertTrue(engine.awaitDecision().ok)
        return engine
    }

    private fun transferring(engine: DeliveryEngine): DeliveryEngine {
        assertTrue(engine.sendDecision(Decision.ACCEPT).ok)
        assertTrue(engine.prepareTransfer().ok)
        assertTrue(engine.beginTransfer(transferId).ok)
        return engine
    }

    // --- pure helpers ---------------------------------------------------------

    @Test
    fun decisionEventMapsAcceptAndReject() {
        assertSame(DeliveryEvent.ACCEPTED, decisionEvent(Decision.ACCEPT))
        assertSame(DeliveryEvent.REJECTED, decisionEvent(Decision.REJECT))
    }

    @Test
    fun createDeliveryResponseCarriesDecision() {
        val accept = createDeliveryResponse(requestId, Decision.ACCEPT)
        val reject = createDeliveryResponse(requestId, Decision.REJECT)
        assertEquals(Decision.ACCEPT, accept.decision)
        assertEquals(Decision.REJECT, reject.decision)
        assertEquals(requestId, reject.requestId)
    }

    @Test
    fun progressIsClampedToZeroToHundred() {
        assertEquals(0L, calculateTransferProgress(0, 100))
        assertEquals(0L, calculateTransferProgress(-5, 100))
        assertEquals(50L, calculateTransferProgress(50, 100))
        assertEquals(0L, calculateTransferProgress(10, 0))
        assertEquals(100L, calculateTransferProgress(5000, 1000))
    }

    // --- sender happy path -----------------------------------------------------

    @Test
    fun senderHappyPath() {
        val engine = engine()
        val sent = engine.registerDeliveryRequest(request())
        assertTrue(sent.ok)
        assertSame(DeliveryEvent.REQUEST_SENT, sent.event)
        assertSame(DeliveryState.REQUEST_SENT, sent.to)
        assertEquals(DeliveryAction.SendMessage(request()), sent.action)
        assertSame(DeliveryState.REQUEST_SENT, engine.state)

        val awaiting = engine.awaitDecision()
        assertTrue(awaiting.ok)
        assertSame(DeliveryEvent.AWAITING_DECISION, awaiting.event)
        assertSame(DeliveryState.WAITING_FOR_DECISION, awaiting.to)
        assertSame(DeliveryAction.None, awaiting.action)

        val accepted = engine.processResponse(DeliveryResponse(requestId, Decision.ACCEPT))
        assertTrue(accepted.ok)
        assertSame(DeliveryEvent.ACCEPTED, accepted.event)
        assertSame(DeliveryState.ACCEPTED, accepted.to)
        assertSame(DeliveryAction.None, accepted.action)

        val prepared = engine.prepareTransfer()
        assertTrue(prepared.ok)
        assertSame(DeliveryEvent.TRANSFER_PREPARED, prepared.event)
        assertSame(DeliveryState.TRANSFER_PREPARING, prepared.to)

        val started = engine.beginTransfer(transferId)
        assertTrue(started.ok)
        assertSame(DeliveryEvent.TRANSFER_STARTED, started.event)
        assertSame(DeliveryState.TRANSFERRING, started.to)
        assertSame(DeliveryAction.BeginStream, started.action)
        assertEquals(transferId, engine.transferId)

        assertTrue(engine.recordBytes(declaredSize).ok)
        assertEquals(100L, engine.progressPercent)

        val completed = engine.completeTransfer()
        assertTrue(completed.ok)
        assertSame(DeliveryEvent.VERIFICATION_INITIATED, completed.event)
        assertSame(DeliveryState.VERIFYING, completed.to)
    }

    // --- receiver happy path ---------------------------------------------------

    @Test
    fun receiverHappyPathSendsAcceptResponse() {
        val engine = awaitingDecision()
        val accept = engine.sendDecision(Decision.ACCEPT)
        assertTrue(accept.ok)
        assertSame(DeliveryEvent.ACCEPTED, accept.event)
        assertSame(DeliveryState.ACCEPTED, accept.to)
        assertEquals(DeliveryResponse(requestId, Decision.ACCEPT), (accept.action as DeliveryAction.SendMessage).message)

        assertTrue(engine.prepareTransfer().ok)
        assertTrue(engine.beginTransfer(transferId).ok)
        assertTrue(engine.recordBytes(declaredSize).ok)
        val complete = engine.completeTransfer()
        assertTrue(complete.ok)
        assertSame(DeliveryEvent.VERIFICATION_INITIATED, complete.event)
        assertSame(DeliveryState.VERIFYING, complete.to)
    }

    @Test
    fun rejectDecisionAlsoSendsDeliveryResponse() {
        val engine = awaitingDecision()
        val rejected = engine.sendDecision(Decision.REJECT)
        assertTrue(rejected.ok)
        assertSame(DeliveryEvent.REJECTED, rejected.event)
        assertSame(DeliveryState.REJECTED, rejected.to)
        assertEquals(DeliveryResponse(requestId, Decision.REJECT), (rejected.action as DeliveryAction.SendMessage).message)
    }

    // --- decision layer: rejection paths --------------------------------------

    @Test
    fun expirationCausesCleanup() {
        val expired = awaitingDecision().expire()
        assertTrue(expired.ok)
        assertSame(DeliveryEvent.EXPIRED, expired.event)
        assertSame(DeliveryState.FAILED, expired.to)
        assertSame(DeliveryAction.Cleanup, expired.action)
    }

    @Test
    fun cancellationDuringPrepare() {
        val engine = transferring(awaitingDecision())
        val cancelled = engine.cancel()
        assertTrue(cancelled.ok)
        assertSame(DeliveryEvent.CANCELLED, cancelled.event)
        assertSame(DeliveryState.CANCELLED, cancelled.to)
        assertSame(DeliveryAction.Cleanup, cancelled.action)
    }

    @Test
    fun connectionLossDuringTransferCleansUp() {
        val lost = transferring(awaitingDecision()).connectionLost()
        assertTrue(lost.ok)
        assertSame(DeliveryEvent.CONNECTION_LOST, lost.event)
        assertSame(DeliveryState.FAILED, lost.to)
        assertSame(DeliveryAction.Cleanup, lost.action)
    }

    @Test
    fun transferTimeoutDuringTransferCleansUp() {
        val timedOut = transferring(awaitingDecision()).transferTimeout()
        assertTrue(timedOut.ok)
        assertSame(DeliveryEvent.TRANSFER_TIMED_OUT, timedOut.event)
        assertSame(DeliveryState.FAILED, timedOut.to)
        assertSame(DeliveryAction.Cleanup, timedOut.action)
    }

    // --- byte accounting / transfer_cancel -------------------------------------

    @Test
    fun byteAccountingEnforcesDeclaredSize() {
        val engine = transferring(awaitingDecision())
        assertEquals(DeliveryProblem.SIZE_EXCEEDED, engine.recordBytes(declaredSize + 1).problem)
        assertEquals(DeliveryProblem.INVALID_BYTES, engine.recordBytes(0).problem)
        assertEquals(DeliveryProblem.INVALID_BYTES, engine.recordBytes(-1).problem)
        assertSame(DeliveryState.TRANSFERRING, engine.state)
        assertTrue(engine.recordBytes(declaredSize).ok)
        assertEquals(100L, engine.progressPercent)
    }

    @Test
    fun completeTransferRequiresExactSize() {
        val engine = transferring(awaitingDecision())
        engine.recordBytes(1000)
        assertEquals(DeliveryProblem.SIZE_MISMATCH, engine.completeTransfer().problem)
        assertSame(DeliveryState.TRANSFERRING, engine.state)
    }

    @Test
    fun processTransferCancelStopsStream() {
        val engine = transferring(awaitingDecision())
        assertEquals(DeliveryProblem.TRANSFER_ID_MISMATCH, engine.processTransferCancel(TransferId("tr_OTHER")).problem)
        val cancelled = engine.processTransferCancel(transferId)
        assertTrue(cancelled.ok)
        assertSame(DeliveryState.CANCELLED, cancelled.to)
        assertSame(DeliveryAction.StopStream, cancelled.action)
    }

    @Test
    fun noTransferIsRejected() {
        val engine = engine()
        assertEquals(DeliveryProblem.NO_TRANSFER, engine.processTransferCancel(transferId).problem)
        assertEquals(DeliveryProblem.NO_TRANSFER, engine.completeTransfer().problem)
    }

    // --- state gating ----------------------------------------------------------

    @Test
    fun sendDecisionRequiresWaitingForDecision() {
        assertEquals(DeliveryProblem.INVALID_STATE, engine().sendDecision(Decision.ACCEPT).problem)
    }

    @Test
    fun processResponseRequiresWaitingForDecision() {
        assertEquals(
            DeliveryProblem.INVALID_STATE,
            engine().processResponse(DeliveryResponse(requestId, Decision.ACCEPT)).problem,
        )
    }

    @Test
    fun recordBytesOnlyInTransferring() {
        val engine = engine()
        engine.receiveIncomingRequest(request())
        assertEquals(DeliveryProblem.INVALID_STATE, engine.recordBytes(1).problem)
    }

    @Test
    fun rejectAndCompleteAreMutuallyExclusive() {
        val engine = awaitingDecision()
        assertTrue(engine.sendDecision(Decision.REJECT).ok)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.completeTransfer().problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.recordBytes(1).problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.sendDecision(Decision.ACCEPT).problem)
    }

    @Test
    fun terminalStateRejectsAllOperations() {
        val engine = awaitingDecision()
        assertTrue(engine.sendDecision(Decision.REJECT).ok)
        assertSame(DeliveryState.REJECTED, engine.state)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.connectionLost().problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.cancel().problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.expire().problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.beginTransfer(transferId).problem)
    }

    @Test
    fun receiveIncomingValidOnlyFromSessionEstablished() {
        val foreign = request().copy(sessionId = SessionId("sess_OTHER"))
        assertEquals(DeliveryProblem.REQUEST_MISMATCH, engine().receiveIncomingRequest(foreign).problem)
        val alreadyAdvanced = engine(DeliveryState.REQUEST_SENT)
        assertEquals(DeliveryProblem.INVALID_STATE, alreadyAdvanced.receiveIncomingRequest(request()).problem)
    }

    @Test
    fun registerDeliveryRequestChecksSessionAndState() {
        val foreign = request().copy(sessionId = SessionId("sess_OTHER"))
        assertEquals(DeliveryProblem.REQUEST_MISMATCH, engine().registerDeliveryRequest(foreign).problem)
        assertEquals(
            DeliveryProblem.INVALID_STATE,
            engine(DeliveryState.REQUEST_SENT).registerDeliveryRequest(request()).problem,
        )
    }

    @Test
    fun processResponseRejectsMismatchedRequest() {
        val engine = engine()
        assertTrue(engine.registerDeliveryRequest(request()).ok)
        engine.awaitDecision()
        val wrong = engine.processResponse(DeliveryResponse(RequestId("req_OTHER"), Decision.ACCEPT))
        assertEquals(DeliveryProblem.RESPONSE_MISMATCH, wrong.problem)
        assertSame(DeliveryState.WAITING_FOR_DECISION, engine.state)
    }

    @Test
    fun transferIdValueClassRejectsGarbageIds() {
        assertThrows(IllegalArgumentException::class.java) { TransferId("bad id") }
        assertThrows(IllegalArgumentException::class.java) { TransferId("-starts-with-dash") }
        assertThrows(IllegalArgumentException::class.java) { TransferId("") }
        TransferId("tr_01")
    }

    // --- transitions never coerce ----------------------------------------------

    @Test
    fun decisionsAreNeverCoerced() {
        val engine = engine()
        engine.receiveIncomingRequest(request())
        assertSame(DeliveryState.REQUEST_SENT, engine.state)
        // processResponse requires WAITING_FOR_DECISION, not REQUEST_SENT.
        assertEquals(
            DeliveryProblem.INVALID_STATE,
            engine.processResponse(DeliveryResponse(requestId, Decision.ACCEPT)).problem,
        )
    }

    // --- wire codec round trips ------------------------------------------------

    @Test
    fun roundTripsTransferProgress() {
        val message: ControlMessage = TransferProgress(transferId, 1000, declaredSize)
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        assertEquals(message, ProtocolJson.decode(json, Limits()).getOrThrow())
        assertTrue(json.contains("\"type\":\"transfer_progress\""))
        assertTrue(json.contains("\"transfer_id\":\"tr_01JTEST\""))
    }

    @Test
    fun roundTripsTransferCancel() {
        val message: ControlMessage = TransferCancel(transferId)
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        assertEquals(message, ProtocolJson.decode(json, Limits()).getOrThrow())
        assertTrue(json.contains("\"type\":\"transfer_cancel\""))
    }

    @Test
    fun transferProgressFrameValidation() {
        assertTrue(ProtocolJson.decode(
            """{"type":"transfer_progress","transfer_id":"tr_01","bytes_transferred":50,"total_bytes":100}""",
            Limits(),
        ).isSuccess)
        assertTrue(ProtocolJson.decode(
            """{"type":"transfer_progress","transfer_id":"tr_01","bytes_transferred":-1,"total_bytes":100}""",
            Limits(),
        ).isFailure)
        assertTrue(ProtocolJson.decode(
            """{"type":"transfer_progress","transfer_id":"tr_01","bytes_transferred":101,"total_bytes":100}""",
            Limits(),
        ).isFailure)
        assertTrue(ProtocolJson.decode(
            """{"type":"transfer_cancel","transfer_id":"tr_01","extra":true}""",
            Limits(),
        ).isFailure)
    }

    @Test
    fun progressNeverChangesDeliveryState() {
        val engine = transferring(awaitingDecision())
        engine.recordBytes(declaredSize / 2)
        assertSame(DeliveryState.TRANSFERRING, engine.state)
        assertTrue(engine.progressPercent in 49L..51L)
    }

    // --- Phase 07: integrity verification & installation handoff ------------

    private fun verifying(): DeliveryEngine {
        val engine = transferring(awaitingDecision())
        assertTrue(engine.recordBytes(declaredSize).ok)
        assertTrue(engine.completeTransfer().ok)
        assertSame(DeliveryState.VERIFYING, engine.state)
        return engine
    }

    private fun verified(): DeliveryEngine {
        val engine = verifying()
        assertEquals(sha.value, engine.expectedDigest)
        assertTrue(engine.completeVerification(sha.value).ok)
        assertSame(DeliveryState.VERIFIED, engine.state)
        return engine
    }

    private fun installReady(): DeliveryEngine {
        val engine = verified()
        assertTrue(engine.prepareInstall().ok)
        assertSame(DeliveryState.INSTALL_READY, engine.state)
        return engine
    }

    private fun handoff(): DeliveryEngine {
        val engine = installReady()
        assertTrue(engine.handoffInstall().ok)
        assertSame(DeliveryState.INSTALLATION_HANDOFF, engine.state)
        return engine
    }

    @Test
    fun verificationSuccessReachesVerified() {
        val engine = verifying()
        val outcome = engine.completeVerification(sha.value)
        assertTrue(outcome.ok)
        assertEquals(DeliveryEvent.VERIFIED, outcome.event)
        assertEquals(DeliveryState.VERIFIED, outcome.to)
        assertEquals(DeliveryAction.None, outcome.action)
        assertNull(outcome.problem)
        assertSame(DeliveryState.VERIFIED, engine.state)
    }

    @Test
    fun verificationIsCaseInsensitive() {
        val engine = verifying()
        assertTrue(engine.completeVerification(sha.value.uppercase()).ok)
        assertSame(DeliveryState.VERIFIED, engine.state)
    }

    @Test
    fun verificationMismatchFailsWithCleanup() {
        val engine = verifying()
        val other = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        val outcome = engine.completeVerification(other)
        assertTrue(outcome.ok)
        assertEquals(DeliveryEvent.INTEGRITY_MISMATCH, outcome.event)
        assertEquals(DeliveryState.FAILED, outcome.to)
        assertEquals(DeliveryAction.Cleanup, outcome.action)
        assertEquals(DeliveryProblem.INTEGRITY_MISMATCH, outcome.problem)
        assertSame(DeliveryState.FAILED, engine.state)
    }

    @Test
    fun verificationRejectsMalformedDigest() {
        val engine = verifying()
        assertEquals(DeliveryProblem.INVALID_DIGEST, engine.completeVerification("not-a-digest").problem)
        assertSame(DeliveryState.VERIFYING, engine.state)
    }

    @Test
    fun verificationRequiresRequestAndState() {
        val bare = DeliveryEngine(sessionId, DeliveryState.VERIFYING)
        assertEquals(DeliveryProblem.NO_REQUEST, bare.completeVerification(sha.value).problem)

        val advanced = verified()
        assertEquals(DeliveryProblem.INVALID_STATE, advanced.completeVerification(sha.value).problem)
    }

    @Test
    fun prepareInstallAndHandoffInvokeInstaller() {
        val engine = verified()
        val prepared = engine.prepareInstall()
        assertTrue(prepared.ok)
        assertSame(DeliveryState.INSTALL_READY, engine.state)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.prepareInstall().problem)

        val handoff = engine.handoffInstall()
        assertTrue(handoff.ok)
        assertEquals(DeliveryEvent.HANDOFF_INITIATED, handoff.event)
        assertEquals(DeliveryState.INSTALLATION_HANDOFF, handoff.to)
        assertEquals(DeliveryAction.InvokeInstaller, handoff.action)
        assertSame(DeliveryState.INSTALLATION_HANDOFF, engine.state)
    }

    @Test
    fun installationCompletedReachesCompleted() {
        val engine = handoff()
        val outcome = engine.installationCompleted()
        assertTrue(outcome.ok)
        assertEquals(DeliveryEvent.COMPLETED, outcome.event)
        assertEquals(DeliveryState.COMPLETED, outcome.to)
        assertEquals(DeliveryAction.Cleanup, outcome.action)
        assertSame(DeliveryState.COMPLETED, engine.state)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.installationCompleted().problem)
    }

    @Test
    fun installationUnavailableFailsBeforeAndDuringHandoff() {
        val ready = installReady()
        val before = ready.installationUnavailable()
        assertTrue(before.ok)
        assertEquals(DeliveryEvent.INSTALLATION_UNAVAILABLE, before.event)
        assertEquals(DeliveryState.FAILED, before.to)
        assertEquals(DeliveryAction.Cleanup, before.action)
        assertSame(DeliveryState.FAILED, ready.state)

        val during = handoff()
        val outcome = during.installationUnavailable()
        assertTrue(outcome.ok)
        assertEquals(DeliveryEvent.INSTALLATION_UNAVAILABLE, outcome.event)
        assertSame(DeliveryState.FAILED, during.state)
    }

    @Test
    fun installationUnavailableRequiresInstallStage() {
        val engine = verified()
        assertEquals(DeliveryProblem.INVALID_STATE, engine.installationUnavailable().problem)
    }

    @Test
    fun machineStaysFrozenInInstallStages() {
        val engine = handoff()
        assertFalse(engine.cancel().ok)
        assertSame(DeliveryState.INSTALLATION_HANDOFF, engine.state)

        val verifiedEngine = verified()
        assertFalse(verifiedEngine.connectionLost().ok)
        assertSame(DeliveryState.VERIFIED, verifiedEngine.state)
    }

    @Test
    fun cancellationStillWorksFromVerifiedAndReady() {
        val fromVerified = verified()
        assertTrue(fromVerified.cancel().ok)
        assertSame(DeliveryState.CANCELLED, fromVerified.state)

        val fromReady = installReady()
        assertTrue(fromReady.cancel().ok)
        assertSame(DeliveryState.CANCELLED, fromReady.state)
    }

    @Test
    fun fullReceiverLifecycleCompletes() {
        val engine = verifying()
        assertTrue(engine.completeVerification(sha.value.uppercase()).ok)
        assertTrue(engine.prepareInstall().ok)
        assertTrue(engine.handoffInstall().ok)
        val done = engine.installationCompleted()
        assertTrue(done.ok)
        assertSame(DeliveryState.COMPLETED, engine.state)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.completeVerification(sha.value).problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.prepareInstall().problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.handoffInstall().problem)
        assertEquals(DeliveryProblem.INVALID_STATE, engine.installationUnavailable().problem)
    }

    @Test
    fun newOpsRejectedFromEveryTerminalState() {
        for (terminal in listOf(
            DeliveryState.COMPLETED,
            DeliveryState.REJECTED,
            DeliveryState.FAILED,
            DeliveryState.CANCELLED,
        )) {
            val engine = DeliveryEngine(sessionId, terminal)
            assertEquals(DeliveryProblem.INVALID_STATE, engine.completeVerification(sha.value).problem)
            assertEquals(DeliveryProblem.INVALID_STATE, engine.prepareInstall().problem)
            assertEquals(DeliveryProblem.INVALID_STATE, engine.handoffInstall().problem)
            assertEquals(DeliveryProblem.INVALID_STATE, engine.installationCompleted().problem)
            assertEquals(DeliveryProblem.INVALID_STATE, engine.installationUnavailable().problem)
        }
    }
}