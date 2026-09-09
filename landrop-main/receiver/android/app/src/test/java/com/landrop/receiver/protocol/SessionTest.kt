package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class SessionTest {

    data class Case(
        val created: Long,
        val expires: Long,
        val now: Long,
        val status: SessionStatus,
    )

    private val cases = listOf(
        Case(0, 1000, 500, SessionStatus.ACTIVE),
        Case(0, 1000, 999, SessionStatus.ACTIVE),
        Case(0, 1000, 1000, SessionStatus.EXPIRED),
        Case(0, 1000, 2000, SessionStatus.EXPIRED),
        Case(500, 1000, 100, SessionStatus.NOT_STARTED),
        Case(500, 1000, 500, SessionStatus.ACTIVE),
    )

    private fun session(created: Long, expires: Long): SessionData =
        SessionData(
            SessionId("sess_01JTEST"),
            ProtocolVersion(1),
            SenderProfile("ISHAQ CYBERTECH"),
            DeviceInfo("Test Device"),
            DeliveryState.SESSION_ESTABLISHED,
            Lifetime(created, expires),
        )

    @Test
    fun fixtureCasesClassifyByTimeWindow() {
        for (c in cases) {
            val session = session(c.created, c.expires)
            assertEquals("now=${c.now} in [${c.created},${c.expires})", c.status, sessionStatus(session, c.now))
            assertEquals(c.status == SessionStatus.ACTIVE, isSessionActive(session, c.now))
            assertEquals(c.status == SessionStatus.EXPIRED, isSessionExpired(session, c.now))
        }
    }

    @Test
    fun boundarySemanticsAreExclusiveAtExpiry() {
        val session = session(0, 1000)
        assertEquals(SessionStatus.ACTIVE, sessionStatus(session, 0))
        assertEquals(SessionStatus.ACTIVE, sessionStatus(session, 999))
        assertEquals(SessionStatus.EXPIRED, sessionStatus(session, 1000))
    }

    @Test
    fun deterministicOutsideWindow() {
        val session = session(0, 1000)
        assertEquals(SessionStatus.NOT_STARTED, sessionStatus(session, -10))
        assertEquals(SessionStatus.EXPIRED, sessionStatus(session, 1_000_000_000_000_000))
    }

    private fun draft() = SessionDraft(
        sessionId = "sess_01JTEST",
        protocolVersion = 1,
        sender = SenderProfile("ISHAQ CYBERTECH"),
        receiver = DeviceInfo("Test Device"),
        lifetime = Lifetime(0, 1000),
    )

    @Test
    fun createsSessionInInitialState() {
        val result = createSession(draft()) as SessionCreateResult.Ok
        assertEquals(DeliveryState.DISCOVERING, result.session.state)
        assertEquals(SessionId("sess_01JTEST"), result.session.sessionId)
        assertEquals(ProtocolVersion(1), result.session.protocolVersion)
    }

    @Test
    fun rejectsInvalidSessionId() {
        assertEquals(
            SessionCreateResult.Failing(SessionProblem.INVALID_SESSION_ID),
            createSession(draft().copy(sessionId = "bad id!")),
        )
    }

    @Test
    fun rejectsUnsupportedProtocol() {
        assertEquals(
            SessionCreateResult.Failing(SessionProblem.UNSUPPORTED_PROTOCOL),
            createSession(draft().copy(protocolVersion = 2)),
        )
    }

    @Test
    fun rejectsZeroDurationLifetime() {
        assertEquals(
            SessionCreateResult.Failing(SessionProblem.INVALID_LIFETIME),
            createSession(draft().copy(lifetime = Lifetime(100, 100))),
        )
    }

    @Test
    fun rejectsInvertedLifetime() {
        assertEquals(
            SessionCreateResult.Failing(SessionProblem.INVALID_LIFETIME),
            createSession(draft().copy(lifetime = Lifetime(1000, 100))),
        )
    }

    @Test
    fun rejectsNegativeCreatedTime() {
        assertEquals(
            SessionCreateResult.Failing(SessionProblem.INVALID_LIFETIME),
            createSession(draft().copy(lifetime = Lifetime(-1, 1000))),
        )
    }
}