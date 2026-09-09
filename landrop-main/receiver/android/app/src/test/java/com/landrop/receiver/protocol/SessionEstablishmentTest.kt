package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionEstablishmentTest {

    private fun draft(version: Int = 1) = SessionDraft(
        sessionId = "sess_01JTEST",
        protocolVersion = version,
        sender = SenderProfile("ISHAQ CYBERTECH"),
        receiver = DeviceInfo("Test Device"),
        lifetime = Lifetime(0, 1000),
    )

    private val prerequisites = EstablishmentPrerequisites(transportEstablished = true, secureChannelEstablished = true)

    @Test
    fun versionNegotiationMatchesFixture() {
        val cases = listOf(
            1 to true,
            2 to false,
            0 to false,
            -1 to false,
        )
        for ((version, supported) in cases) {
            assertEquals(supported, supportsProtocolVersion(version))
        }
        // Non-integer versions are rejected by the codec before this gate.
        assertEquals(true, supportsProtocolVersion(1))
    }

    @Test
    fun establishesSessionWithFullPrerequisites() {
        val result = establishSession(draft(), prerequisites) as SessionEstablishmentResult.Ok
        assertEquals(SessionId("sess_01JTEST"), result.session.sessionId)
        assertEquals(DeliveryState.DISCOVERING, result.session.state)
        assertEquals(DeliveryEvent.SESSION_ESTABLISHED, sessionEstablishedEvent())
    }

    @Test
    fun refusesEstablishmentWithoutTransport() {
        val result = establishSession(draft(), EstablishmentPrerequisites())
        assertEquals(
            SessionEstablishmentResult.Failing(SessionEstablishmentProblem.CONNECTION_NOT_ESTABLISHED),
            result,
        )
    }

    @Test
    fun refusesEstablishmentWithoutSecureChannel() {
        val result = establishSession(draft(), EstablishmentPrerequisites(transportEstablished = true))
        assertEquals(
            SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SECURE_CHANNEL_NOT_ESTABLISHED),
            result,
        )
    }

    @Test
    fun refusesUnsupportedProtocolVersion() {
        val result = establishSession(draft(2), prerequisites)
        assertEquals(
            SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SESSION_ISSUE),
            result,
        )
    }

    @Test
    fun reusesSessionGuardsForInvalidDrafts() {
        val invalidId = establishSession(draft().copy(sessionId = "bad id!"), prerequisites)
        assertEquals(
            SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SESSION_ISSUE),
            invalidId,
        )
        val invalidLifetime = establishSession(draft().copy(lifetime = Lifetime(1000, 1000)), prerequisites)
        assertEquals(
            SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SESSION_ISSUE),
            invalidLifetime,
        )
    }

    @Test
    fun sessionEstablishedEventIsOnlyTheDefinedDeliveryEvent() {
        assertEquals("SESSION_ESTABLISHED", sessionEstablishedEvent().name)
        assertEquals(DeliveryEvent.SESSION_ESTABLISHED, sessionEstablishedEvent())
    }

    @Test
    fun isDeterministicFunctionOfDraftAndPrerequisites() {
        assertEquals(establishSession(draft(), prerequisites), establishSession(draft(), prerequisites))
        assertEquals(establishSession(draft(9), prerequisites), establishSession(draft(9), prerequisites))
    }
}