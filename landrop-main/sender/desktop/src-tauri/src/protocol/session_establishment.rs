// Session establishment boundary (protocol spec §5 steps 6-7, §7; project
// spec §15; architecture §28). Uses the Session foundation — no second
// session implementation and no invented handshake messages (the wire-level
// negotiation mechanism is a SPECIFICATION GAP; the only defined version is 1,
// so negotiation is a deterministic version gate).

use super::{create_session, DeliveryEvent, DeviceInfo, Lifetime, SenderProfile, SessionDraft, CURRENT_PROTOCOL_VERSION};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionEstablishmentProblem {
    ConnectionNotEstablished,
    SecureChannelNotEstablished,
    SessionIssue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct EstablishmentPrerequisites {
    pub transport_established: bool,
    pub secure_channel_established: bool,
}

// Version negotiation. The protocol is locked at v1 (protocol spec §6);
// unsupported versions surface the existing UnsupportedProtocol semantics via
// create_session.
pub fn supports_protocol_version(version: i32) -> bool {
    version == CURRENT_PROTOCOL_VERSION
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionEstablishmentResult {
    Completed(super::SessionData),
    Rejected(SessionEstablishmentProblem),
}

// A session may only be established on a validated connection: transport open,
// TLS 1.3 established, version supported, and a valid session draft. Failure
// at any step leaves NO session and NO partial establishment.
pub fn establish_session(
    draft: SessionDraft,
    prerequisites: EstablishmentPrerequisites,
) -> SessionEstablishmentResult {
    if !prerequisites.transport_established {
        return SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::ConnectionNotEstablished);
    }
    if !prerequisites.secure_channel_established {
        return SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SecureChannelNotEstablished);
    }
    if !supports_protocol_version(draft.protocol_version) {
        return SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SessionIssue);
    }
    match create_session(draft) {
        Ok(session) => SessionEstablishmentResult::Completed(session),
        Err(_) => SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SessionIssue),
    }
}

// The delivery event that corresponds to a successful session establishment.
// Kept separate so networking never emits it without an explicit, valid
// establishment result.
pub fn session_established_event() -> DeliveryEvent {
    DeliveryEvent::SessionEstablished
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::DeliveryState;

    fn draft(version: i32) -> SessionDraft {
        SessionDraft {
            session_id: "sess_01JTEST".to_string(),
            protocol_version: version,
            sender: SenderProfile { display_name: "ISHAQ CYBERTECH".to_string() },
            receiver: DeviceInfo { device_name: "Test Device".to_string() },
            lifetime: Lifetime { created_at_ms: 0, expires_at_ms: 1000 },
        }
    }

    #[test]
    fn version_negotiation_matches_fixture() {
        let cases = [1i32, 2, 0, -1];
        for version in cases {
            assert_eq!(
                supports_protocol_version(version),
                version == 1,
                "version {version}"
            );
        }
        // Non-integer versions are rejected by the codec before this gate.
        assert!(supports_protocol_version(1));
    }

    #[test]
    fn establishes_session_with_full_prerequisites() {
        let result = establish_session(
            draft(1),
            EstablishmentPrerequisites { transport_established: true, secure_channel_established: true },
        );
        match result {
            SessionEstablishmentResult::Completed(session) => {
                assert_eq!(session.session_id.as_str(), "sess_01JTEST");
                assert_eq!(session.state, DeliveryState::Discovering);
            }
            SessionEstablishmentResult::Rejected(_) => panic!("expected establishment"),
        }
        assert_eq!(session_established_event(), DeliveryEvent::SessionEstablished);
    }

    #[test]
    fn refuses_without_transport() {
        let result = establish_session(draft(1), EstablishmentPrerequisites::default());
        assert_eq!(
            result,
            SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::ConnectionNotEstablished)
        );
    }

    #[test]
    fn refuses_without_secure_channel() {
        let result = establish_session(
            draft(1),
            EstablishmentPrerequisites { transport_established: true, secure_channel_established: false },
        );
        assert_eq!(
            result,
            SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SecureChannelNotEstablished)
        );
    }

    #[test]
    fn refuses_unsupported_protocol_version() {
        let result = establish_session(
            draft(2),
            EstablishmentPrerequisites { transport_established: true, secure_channel_established: true },
        );
        assert_eq!(
            result,
            SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SessionIssue)
        );
    }

    #[test]
    fn reuses_session_guards_for_invalid_drafts() {
        let mut bad_id = draft(1);
        bad_id.session_id = "bad id!".to_string();
        let result = establish_session(
            bad_id,
            EstablishmentPrerequisites { transport_established: true, secure_channel_established: true },
        );
        assert_eq!(
            result,
            SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SessionIssue)
        );

        let mut bad_lifetime = draft(1);
        bad_lifetime.lifetime = Lifetime { created_at_ms: 1000, expires_at_ms: 1000 };
        let result = establish_session(
            bad_lifetime,
            EstablishmentPrerequisites { transport_established: true, secure_channel_established: true },
        );
        assert_eq!(
            result,
            SessionEstablishmentResult::Rejected(SessionEstablishmentProblem::SessionIssue)
        );
    }

    #[test]
    fn is_deterministic_function_of_draft_and_prerequisites() {
        let prerequisites = EstablishmentPrerequisites { transport_established: true, secure_channel_established: true };
        assert_eq!(establish_session(draft(1), prerequisites), establish_session(draft(1), prerequisites));
        assert_eq!(establish_session(draft(9), prerequisites), establish_session(draft(9), prerequisites));
    }
}