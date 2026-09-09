package com.landrop.receiver.protocol

enum class SessionStatus { NOT_STARTED, ACTIVE, EXPIRED }

// A session is active iff its time window [created_at_ms, expires_at_ms) has
// been entered and has not yet ended. now == expires_at_ms is expired.
fun sessionStatus(session: SessionData, nowMs: Long): SessionStatus = when {
    nowMs < session.lifetime.createdAtMs -> SessionStatus.NOT_STARTED
    nowMs >= session.lifetime.expiresAtMs -> SessionStatus.EXPIRED
    else -> SessionStatus.ACTIVE
}

fun isSessionActive(session: SessionData, nowMs: Long): Boolean =
    sessionStatus(session, nowMs) == SessionStatus.ACTIVE

fun isSessionExpired(session: SessionData, nowMs: Long): Boolean =
    sessionStatus(session, nowMs) == SessionStatus.EXPIRED

enum class SessionProblem { INVALID_SESSION_ID, UNSUPPORTED_PROTOCOL, INVALID_LIFETIME }

data class SessionDraft(
    val sessionId: String,
    val protocolVersion: Int,
    val sender: SenderProfile,
    val receiver: DeviceInfo,
    val lifetime: Lifetime,
)

sealed class SessionCreateResult {
    data class Ok(val session: SessionData) : SessionCreateResult()
    data class Failing(val problem: SessionProblem) : SessionCreateResult()
}

// Creates a session in the initial delivery state. Uniform messages
// (presentation text / notification) are not part of the session; they arrive
// with each delivery request. Lifetime rules mirror Lifetime::validate.
fun createSession(draft: SessionDraft): SessionCreateResult {
    val sessionId = try {
        SessionId(draft.sessionId)
    } catch (_: IllegalArgumentException) {
        return SessionCreateResult.Failing(SessionProblem.INVALID_SESSION_ID)
    }
    if (draft.protocolVersion != CURRENT_PROTOCOL_VERSION) {
        return SessionCreateResult.Failing(SessionProblem.UNSUPPORTED_PROTOCOL)
    }
    if (draft.lifetime.createdAtMs < 0 || draft.lifetime.expiresAtMs <= draft.lifetime.createdAtMs) {
        return SessionCreateResult.Failing(SessionProblem.INVALID_LIFETIME)
    }
    return SessionCreateResult.Ok(
        SessionData(
            sessionId,
            ProtocolVersion(draft.protocolVersion),
            draft.sender,
            draft.receiver,
            DeliveryState.DISCOVERING,
            draft.lifetime,
        ),
    )
}