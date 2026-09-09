// Session model helpers (protocol spec §7, project spec §17). Deterministic
// expiration and creation rules over the Phase 02 SessionData/Lifetime types.
// No session-state machine is invented here; the delivery machine owns state.

use super::{DeliveryState, DeviceInfo, Lifetime, ProtocolVersion, SessionId, SenderProfile, SessionData, CURRENT_PROTOCOL_VERSION};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    NotStarted,
    Active,
    Expired,
}

// A session is active iff its time window [created_at_ms, expires_at_ms) has
// been entered and has not yet ended. now == expires_at_ms is expired.
pub fn session_status(session: &SessionData, now_ms: i64) -> SessionStatus {
    if now_ms < session.lifetime.created_at_ms {
        SessionStatus::NotStarted
    } else if now_ms >= session.lifetime.expires_at_ms {
        SessionStatus::Expired
    } else {
        SessionStatus::Active
    }
}

pub fn is_session_active(session: &SessionData, now_ms: i64) -> bool {
    session_status(session, now_ms) == SessionStatus::Active
}

pub fn is_session_expired(session: &SessionData, now_ms: i64) -> bool {
    session_status(session, now_ms) == SessionStatus::Expired
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionProblem {
    InvalidSessionId,
    UnsupportedProtocol,
    InvalidLifetime,
}

pub struct SessionDraft {
    pub session_id: String,
    pub protocol_version: i32,
    pub sender: SenderProfile,
    pub receiver: DeviceInfo,
    pub lifetime: Lifetime,
}

// Creates a session in the initial delivery state. Uniform messages
// (presentation text / notification) are not part of the session; they arrive
// with each delivery request. Lifetime rules mirror Lifetime::validate.
pub fn create_session(draft: SessionDraft) -> Result<SessionData, SessionProblem> {
    let session_id = SessionId::new(draft.session_id).map_err(|_| SessionProblem::InvalidSessionId)?;
    if draft.protocol_version != CURRENT_PROTOCOL_VERSION {
        return Err(SessionProblem::UnsupportedProtocol);
    }
    if draft.lifetime.created_at_ms < 0 || draft.lifetime.expires_at_ms <= draft.lifetime.created_at_ms {
        return Err(SessionProblem::InvalidLifetime);
    }
    Ok(SessionData {
        session_id,
        protocol_version: ProtocolVersion(draft.protocol_version),
        sender: draft.sender,
        receiver: draft.receiver,
        state: DeliveryState::Discovering,
        lifetime: draft.lifetime,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(state: DeliveryState, created: i64, expires: i64) -> SessionData {
        SessionData {
            session_id: SessionId::new("sess_01JTEST".to_string()).unwrap(),
            protocol_version: ProtocolVersion(1),
            sender: SenderProfile { display_name: "ISHAQ CYBERTECH".to_string() },
            receiver: DeviceInfo { device_name: "Test Device".to_string() },
            state,
            lifetime: Lifetime { created_at_ms: created, expires_at_ms: expires },
        }
    }

    #[test]
    fn fixture_cases_classify_by_time_window() {
        let cases = [
            (0, 1000, 500, SessionStatus::Active),
            (0, 1000, 999, SessionStatus::Active),
            (0, 1000, 1000, SessionStatus::Expired),
            (0, 1000, 2000, SessionStatus::Expired),
            (500, 1000, 100, SessionStatus::NotStarted),
            (500, 1000, 500, SessionStatus::Active),
        ];
        for (created, expires, now, expected) in cases {
            let session = session(DeliveryState::SessionEstablished, created, expires);
            assert_eq!(session_status(&session, now), expected, "now={} in [{},{})", now, created, expires);
            assert_eq!(is_session_active(&session, now), expected == SessionStatus::Active);
            assert_eq!(is_session_expired(&session, now), expected == SessionStatus::Expired);
        }
    }

    #[test]
    fn boundary_semantics_are_exclusive_at_expiry() {
        let session = session(DeliveryState::SessionEstablished, 0, 1000);
        assert_eq!(session_status(&session, 0), SessionStatus::Active);
        assert_eq!(session_status(&session, 999), SessionStatus::Active);
        assert_eq!(session_status(&session, 1000), SessionStatus::Expired);
    }

    #[test]
    fn deterministic_outside_window() {
        let session = session(DeliveryState::SessionEstablished, 0, 1000);
        assert_eq!(session_status(&session, -10), SessionStatus::NotStarted);
        assert_eq!(session_status(&session, 1_000_000_000_000_000), SessionStatus::Expired);
    }

    fn draft() -> SessionDraft {
        SessionDraft {
            session_id: "sess_01JTEST".to_string(),
            protocol_version: 1,
            sender: SenderProfile { display_name: "ISHAQ CYBERTECH".to_string() },
            receiver: DeviceInfo { device_name: "Test Device".to_string() },
            lifetime: Lifetime { created_at_ms: 0, expires_at_ms: 1000 },
        }
    }

    #[test]
    fn creates_session_in_initial_state() {
        let result = create_session(draft()).unwrap();
        assert_eq!(result.state, DeliveryState::Discovering);
        assert_eq!(result.session_id, SessionId::new("sess_01JTEST".to_string()).unwrap());
        assert_eq!(result.protocol_version, ProtocolVersion(1));
    }

    #[test]
    fn rejects_invalid_session_id() {
        assert_eq!(create_session(SessionDraft { session_id: "bad id!".to_string(), ..draft() }), Err(SessionProblem::InvalidSessionId));
    }

    #[test]
    fn rejects_unsupported_protocol() {
        let mut d = draft();
        d.protocol_version = 2;
        assert_eq!(create_session(d), Err(SessionProblem::UnsupportedProtocol));
    }

    #[test]
    fn rejects_zero_duration_lifetime() {
        let mut d = draft();
        d.lifetime = Lifetime { created_at_ms: 100, expires_at_ms: 100 };
        assert_eq!(create_session(d), Err(SessionProblem::InvalidLifetime));
    }

    #[test]
    fn rejects_inverted_lifetime() {
        let mut d = draft();
        d.lifetime = Lifetime { created_at_ms: 1000, expires_at_ms: 100 };
        assert_eq!(create_session(d), Err(SessionProblem::InvalidLifetime));
    }

    #[test]
    fn rejects_negative_created_time() {
        let mut d = draft();
        d.lifetime = Lifetime { created_at_ms: -1, expires_at_ms: 1000 };
        assert_eq!(create_session(d), Err(SessionProblem::InvalidLifetime));
    }
}