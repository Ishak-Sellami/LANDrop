package com.landrop.receiver.protocol

// Session establishment boundary (protocol spec §5 steps 6-7, §7; project
// spec §15; architecture §28). Uses the Session foundation — no second
// session implementation and no invented handshake messages (the wire-level
// negotiation mechanism is a SPECIFICATION GAP; the only defined version is 1,
// so negotiation is a deterministic version gate).

enum class SessionEstablishmentProblem {
    CONNECTION_NOT_ESTABLISHED,
    SECURE_CHANNEL_NOT_ESTABLISHED,
    SESSION_ISSUE,
}

// Version negotiation. The protocol is locked at v1 (protocol spec §6);
// unsupported versions surface the existing UNSUPPORTED_PROTOCOL semantics via
// createSession.
fun supportsProtocolVersion(version: Int): Boolean =
    version == CURRENT_PROTOCOL_VERSION

data class EstablishmentPrerequisites(
    val transportEstablished: Boolean = false,
    val secureChannelEstablished: Boolean = false,
)

sealed class SessionEstablishmentResult {
    data class Ok(val session: SessionData) : SessionEstablishmentResult()
    data class Failing(val problem: SessionEstablishmentProblem) : SessionEstablishmentResult()
}

// A session may only be established on a validated connection: transport open,
// TLS 1.3 established, version supported, and a valid session draft. Failure
// at any step leaves NO session and NO partial establishment.
fun establishSession(
    draft: SessionDraft,
    prerequisites: EstablishmentPrerequisites,
): SessionEstablishmentResult {
    if (!prerequisites.transportEstablished) {
        return SessionEstablishmentResult.Failing(SessionEstablishmentProblem.CONNECTION_NOT_ESTABLISHED)
    }
    if (!prerequisites.secureChannelEstablished) {
        return SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SECURE_CHANNEL_NOT_ESTABLISHED)
    }
    if (!supportsProtocolVersion(draft.protocolVersion)) {
        return SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SESSION_ISSUE)
    }
    return when (val created = createSession(draft)) {
        is SessionCreateResult.Ok -> SessionEstablishmentResult.Ok(created.session)
        is SessionCreateResult.Failing -> SessionEstablishmentResult.Failing(SessionEstablishmentProblem.SESSION_ISSUE)
    }
}

// The delivery event that corresponds to a successful session establishment.
// Kept separate so networking never emits it without an explicit, valid
// establishment result.
fun sessionEstablishedEvent(): DeliveryEvent = DeliveryEvent.SESSION_ESTABLISHED