use super::codec::{decode_message, encode_message};
use super::connection::*;
use super::delivery::*;
use super::discovery::*;
use super::enums::*;
use super::identifiers::*;
use super::models::*;
use super::secure_channel::*;
use super::session_establishment::*;
use super::state_machine::*;
use super::validation::{Limits, Validate};
use serde_json;

fn default_limits() -> Limits {
    Limits::default()
}

fn valid_request() -> DeliveryRequest {
    DeliveryRequest {
        protocol_version: ProtocolVersion(1),
        request_id: RequestId::new("req_01JTEST").unwrap(),
        session_id: SessionId::new("sess_01JTEST").unwrap(),
        presentation: Presentation { mode: PresentationMode::Gui },
        sender: SenderProfile { display_name: "ISHAQ CYBERTECH".into() },
        application: ApplicationMetadata {
            identity: ApkIdentity {
                package_name: "com.example.application".into(),
                size_bytes: 26_004_608,
                sha256: Sha256::new(
                    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                )
                .unwrap(),
            },
            presentation: ApplicationPresentation {
                name: "My Application".into(),
                version: "1.4.2".into(),
                description: "A local test application.".into(),
            },
        },
    }
}

// â”€â”€ Serialization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn encode_delivery_request_produces_valid_json() {
    let req = valid_request();
    let msg = ControlMessage::DeliveryRequest(req);
    let json = encode_message(&msg, &default_limits()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "delivery_request");
    assert_eq!(v["protocol_version"], 1);
    assert_eq!(v["request_id"], "req_01JTEST");
    assert_eq!(v["presentation"]["mode"], "GUI");
    assert_eq!(v["sender"]["display_name"], "ISHAQ CYBERTECH");
    assert_eq!(v["application"]["package_name"], "com.example.application");
    assert_eq!(v["application"]["size_bytes"], 26_004_608);
}

#[test]
fn round_trip_delivery_request() {
    let req = valid_request();
    let msg = ControlMessage::DeliveryRequest(req.clone());
    let json = encode_message(&msg, &default_limits()).unwrap();
    let decoded = decode_message(&json, &default_limits()).unwrap();
    assert_eq!(decoded, msg);
}

#[test]
fn round_trip_delivery_response() {
    let resp = DeliveryResponse {
        request_id: RequestId::new("req_01JTEST").unwrap(),
        decision: Decision::Accept,
    };
    let msg = ControlMessage::DeliveryResponse(resp.clone());
    let json = encode_message(&msg, &default_limits()).unwrap();
    let decoded = decode_message(&json, &default_limits()).unwrap();
    assert_eq!(decoded, msg);
}

#[test]
fn round_trip_error_message() {
    let err = ErrorMessage {
        request_id: RequestId::new("req_01JTEST").unwrap(),
        code: ErrorCode::IntegrityMismatch,
        message: "Received file failed integrity verification.".into(),
    };
    let msg = ControlMessage::Error(err.clone());
    let json = encode_message(&msg, &default_limits()).unwrap();
    let decoded = decode_message(&json, &default_limits()).unwrap();
    assert_eq!(decoded, msg);
}

#[test]
fn notification_mode_round_trip() {
    let mut req = valid_request();
    req.presentation = Presentation { mode: PresentationMode::Notification };
    let msg = ControlMessage::DeliveryRequest(req);
    let json = encode_message(&msg, &default_limits()).unwrap();
    let decoded = decode_message(&json, &default_limits()).unwrap();
    assert_eq!(decoded, msg);
}

// â”€â”€ Deserialization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn decode_valid_json() {
    let req = valid_request();
    let json = encode_message(&ControlMessage::DeliveryRequest(req), &default_limits()).unwrap();
    let decoded = decode_message(&json, &default_limits()).unwrap();
    assert!(matches!(decoded, ControlMessage::DeliveryRequest(_)));
}

#[test]
fn reject_empty_string() {
    assert!(decode_message("", &default_limits()).is_err());
}

#[test]
fn reject_array_input() {
    assert!(decode_message("[]", &default_limits()).is_err());
}

#[test]
fn reject_null_input() {
    assert!(decode_message("null", &default_limits()).is_err());
}

#[test]
fn reject_boolean_input() {
    assert!(decode_message("true", &default_limits()).is_err());
}

#[test]
fn reject_empty_object() {
    assert!(decode_message("{}", &default_limits()).is_err());
}

#[test]
fn reject_unknown_type() {
    let json = r#"{"type":"unknown","request_id":"req_01JTEST"}"#;
    assert!(decode_message(json, &default_limits()).is_err());
}

// â”€â”€ Enum serialization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn presentation_mode_serializes_correctly() {
    let gui = Presentation { mode: PresentationMode::Gui };
    let json = serde_json::to_string(&gui).unwrap();
    assert!(json.contains(r#""GUI""#));

    let notif = Presentation { mode: PresentationMode::Notification };
    let json = serde_json::to_string(&notif).unwrap();
    assert!(json.contains(r#""NOTIFICATION""#));
}

#[test]
fn decision_serializes_correctly() {
    let accept = serde_json::to_string(&Decision::Accept).unwrap();
    assert_eq!(accept, r#""ACCEPT""#);
    let reject = serde_json::to_string(&Decision::Reject).unwrap();
    assert_eq!(reject, r#""REJECT""#);
}

#[test]
fn error_code_serializes_correctly() {
    let code = serde_json::to_string(&ErrorCode::IntegrityMismatch).unwrap();
    assert_eq!(code, r#""INTEGRITY_MISMATCH""#);
}

#[test]
fn delivery_state_count_matches_spec() {
    let states = [
        DeliveryState::Discovering, DeliveryState::Available,
        DeliveryState::Connecting, DeliveryState::SecureChannel,
        DeliveryState::SessionEstablished, DeliveryState::RequestSent,
        DeliveryState::WaitingForDecision, DeliveryState::Accepted,
        DeliveryState::TransferPreparing, DeliveryState::Transferring,
        DeliveryState::Verifying, DeliveryState::Verified,
        DeliveryState::InstallReady, DeliveryState::InstallationHandoff,
        DeliveryState::Completed, DeliveryState::Rejected,
        DeliveryState::Failed, DeliveryState::Cancelled,
    ];
    assert_eq!(states.len(), 18);
}

#[test]
fn error_code_count_matches_spec() {
    let codes = [
        ErrorCode::InvalidRequest, ErrorCode::UnsupportedProtocol,
        ErrorCode::RequestExpired, ErrorCode::UserRejected,
        ErrorCode::TransferCancelled, ErrorCode::TransferTimeout,
        ErrorCode::ConnectionLost, ErrorCode::FileTooLarge,
        ErrorCode::InvalidMetadata, ErrorCode::IntegrityMismatch,
        ErrorCode::InstallationUnavailable, ErrorCode::InternalError,
    ];
    assert_eq!(codes.len(), 12);
}

// â”€â”€ Validation â€” protocol version â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_protocol_version() {
    let v = ProtocolVersion(1);
    assert!(v.validate(&default_limits()).is_ok());
}

#[test]
fn reject_version_zero() {
    let v = ProtocolVersion(0);
    let err = v.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRequest);
}

#[test]
fn reject_negative_version() {
    let v = ProtocolVersion(-1);
    let err = v.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidRequest);
}

#[test]
fn reject_unsupported_version() {
    let v = ProtocolVersion(2);
    let err = v.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::UnsupportedProtocol);
}

// â”€â”€ Validation â€” identifiers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_id() {
    assert!(RequestId::new("req_01JTEST").is_ok());
    assert!(RequestId::new("a").is_ok());
    assert!(RequestId::new("A-0_1").is_ok());
}

#[test]
fn reject_empty_id() {
    assert!(RequestId::new("").is_err());
}

#[test]
fn reject_id_with_space() {
    assert!(RequestId::new(" ").is_err());
}

#[test]
fn reject_id_starting_with_underscore() {
    assert!(RequestId::new("_first").is_err());
}

#[test]
fn reject_id_with_slash() {
    assert!(RequestId::new("a/b").is_err());
}

#[test]
fn reject_id_with_dot() {
    assert!(RequestId::new("a.b").is_err());
}

// â”€â”€ Validation â€” SHA-256 â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_sha256() {
    assert!(Sha256::new(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    )
    .is_ok());
}

#[test]
fn reject_short_sha256() {
    assert!(Sha256::new("abc123").is_err());
}

#[test]
fn reject_non_hex_sha256() {
    assert!(Sha256::new(
        "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
    )
    .is_err());
}

// â”€â”€ Validation â€” sender profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_sender() {
    let s = SenderProfile { display_name: "ISHAQ CYBERTECH".into() };
    assert!(s.validate(&default_limits()).is_ok());
}

#[test]
fn reject_blank_sender_name() {
    let s = SenderProfile { display_name: "   ".into() };
    let err = s.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidMetadata);
}

// â”€â”€ Validation â€” application metadata â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_application() {
    let req = valid_request();
    assert!(req.application.validate(&default_limits()).is_ok());
}

#[test]
fn reject_invalid_package_name() {
    let mut req = valid_request();
    req.application.identity.package_name = "nocomponent".into();
    let err = req.application.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidMetadata);
}

#[test]
fn reject_package_name_with_path_traversal() {
    let mut req = valid_request();
    req.application.identity.package_name = "../application".into();
    let err = req.application.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidMetadata);
}

#[test]
fn reject_zero_size() {
    let mut req = valid_request();
    req.application.identity.size_bytes = 0;
    let err = req.application.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidMetadata);
}

#[test]
fn reject_negative_size() {
    let mut req = valid_request();
    req.application.identity.size_bytes = -1;
    let err = req.application.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidMetadata);
}

#[test]
fn reject_oversized_apk() {
    let mut req = valid_request();
    req.application.identity.size_bytes = 4_294_967_297;
    let err = req.application.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::FileTooLarge);
}

#[test]
fn reject_empty_name() {
    let mut req = valid_request();
    req.application.presentation.name = "".into();
    let err = req.application.validate(&default_limits()).unwrap_err();
    assert_eq!(err.code, ErrorCode::InvalidMetadata);
}

// â”€â”€ Validation â€” control message â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn validate_delivery_request() {
    let req = valid_request();
    let msg = ControlMessage::DeliveryRequest(req);
    assert!(msg.validate(&default_limits()).is_ok());
}

#[test]
fn validate_delivery_response() {
    let resp = DeliveryResponse {
        request_id: RequestId::new("req_01JTEST").unwrap(),
        decision: Decision::Accept,
    };
    let msg = ControlMessage::DeliveryResponse(resp);
    assert!(msg.validate(&default_limits()).is_ok());
}

#[test]
fn validate_error_message() {
    let err = ErrorMessage {
        request_id: RequestId::new("req_01JTEST").unwrap(),
        code: ErrorCode::InternalError,
        message: "An error occurred.".into(),
    };
    let msg = ControlMessage::Error(err);
    assert!(msg.validate(&default_limits()).is_ok());
}

// â”€â”€ Validation â€” Lifetime â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_lifetime() {
    let l = Lifetime { created_at_ms: 1000, expires_at_ms: 2000 };
    assert!(l.validate(&default_limits()).is_ok());
}

#[test]
fn reject_negative_created_at() {
    let l = Lifetime { created_at_ms: -1, expires_at_ms: 2000 };
    assert!(l.validate(&default_limits()).is_err());
}

#[test]
fn reject_equal_timestamps() {
    let l = Lifetime { created_at_ms: 1000, expires_at_ms: 1000 };
    assert!(l.validate(&default_limits()).is_err());
}

#[test]
fn reject_expires_before_created() {
    let l = Lifetime { created_at_ms: 2000, expires_at_ms: 1000 };
    assert!(l.validate(&default_limits()).is_err());
}

// â”€â”€ Validation â€” SessionData â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_session_data() {
    let sd = SessionData {
        session_id: SessionId::new("sess_01JTEST").unwrap(),
        protocol_version: ProtocolVersion(1),
        sender: SenderProfile { display_name: "Test".into() },
        receiver: DeviceInfo { device_name: "Android Device".into() },
        state: DeliveryState::Discovering,
        lifetime: Lifetime { created_at_ms: 1000, expires_at_ms: 2000 },
    };
    assert!(sd.validate(&default_limits()).is_ok());
}

// â”€â”€ Validation â€” ApkVersion â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn accept_valid_apk_version() {
    let v = ApkVersion {
        version_code: Some(42),
        version_name: Some("1.0.0".into()),
    };
    assert!(v.validate(&default_limits()).is_ok());
}

#[test]
fn reject_negative_version_code() {
    let v = ApkVersion { version_code: Some(-1), version_name: None };
    assert!(v.validate(&default_limits()).is_err());
}

// â”€â”€ Architectural invariants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn presentation_mode_not_a_delivery_state() {
    let modes = [PresentationMode::Gui, PresentationMode::Notification];
    let states = [
        DeliveryState::Discovering, DeliveryState::Available,
        DeliveryState::Connecting, DeliveryState::SecureChannel,
        DeliveryState::SessionEstablished, DeliveryState::RequestSent,
        DeliveryState::WaitingForDecision, DeliveryState::Accepted,
        DeliveryState::TransferPreparing, DeliveryState::Transferring,
        DeliveryState::Verifying, DeliveryState::Verified,
        DeliveryState::InstallReady, DeliveryState::InstallationHandoff,
        DeliveryState::Completed, DeliveryState::Rejected,
        DeliveryState::Failed, DeliveryState::Cancelled,
    ];
    for mode in &modes {
        for state in &states {
            assert_ne!(format!("{:?}", mode), format!("{:?}", state));
        }
    }
}

#[test]
fn sender_controlled_presentation_is_reflected() {
    let mut gui_req = valid_request();
    gui_req.presentation = Presentation { mode: PresentationMode::Gui };
    let mut notif_req = valid_request();
    notif_req.presentation = Presentation { mode: PresentationMode::Notification };

    let gui_json = encode_message(&ControlMessage::DeliveryRequest(gui_req), &default_limits()).unwrap();
    let notif_json = encode_message(&ControlMessage::DeliveryRequest(notif_req), &default_limits()).unwrap();

    assert!(gui_json.contains(r#""mode":"GUI""#));
    assert!(notif_json.contains(r#""mode":"NOTIFICATION""#));
}

#[test]
fn apk_identity_separate_from_presentation_metadata() {
    let req = valid_request();
    // Identity fields
    assert_eq!(req.application.identity.package_name, "com.example.application");
    assert_eq!(req.application.identity.size_bytes, 26_004_608);
    // Presentation fields
    assert_eq!(req.application.presentation.name, "My Application");
    assert_eq!(req.application.presentation.version, "1.4.2");
    assert_eq!(req.application.presentation.description, "A local test application.");
    // No cross-contamination
    assert_ne!(
        req.application.identity.package_name,
        req.application.presentation.name
    );
}

// â”€â”€ Protocol version on wire â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn protocol_version_is_one() {
    assert_eq!(CURRENT_PROTOCOL_VERSION, 1);
}

// â”€â”€ Phase 05 networking composition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[test]
fn networking_flow_reaches_session_established() {
    // discovery (protocol Â§4)
    let raw = RawDiscoveryInfo {
        service: DISCOVERY_SERVICE_TYPE.to_string(),
        hostname: "receiver-device.local".to_string(),
        port: 45821,
        protocol_version: 1,
        device_name: "Android Device".to_string(),
        extra_txt: vec![],
    };
    let info = parse_discovery_info(raw).unwrap();
    assert!(is_discovery_supported_version(&info));
    let mut registry = DiscoveryRegistry::new();
    registry.upsert(info);
    assert_eq!(registry.size(), 1);

    // connection (protocol Â§5 steps 1-2)
    let mut connection = ConnectionAttempt::new();
    assert_eq!(connection.begin(), Some(DeliveryEvent::ConnectInitiated));
    assert_eq!(connection.complete(ConnectionOutcome::Established), None);

    // TLS 1.3 on the open transport (step 3-4)
    let mut channel = SecureChannelAttempt::new();
    assert_eq!(channel.begin(), None);
    assert_eq!(
        channel.complete(SecureChannelOutcome::Established),
        Some(DeliveryEvent::SecureChannelEstablished)
    );

    // negotiation (step 5) + session establishment (steps 6-7)
    assert!(supports_protocol_version(1));
    let est = establish_session(
        SessionDraft {
            session_id: "sess_01JTEST".to_string(),
            protocol_version: 1,
            sender: SenderProfile { display_name: "ISHAQ CYBERTECH".to_string() },
            receiver: DeviceInfo { device_name: "Test Device".to_string() },
            lifetime: Lifetime { created_at_ms: 0, expires_at_ms: 1000 },
        },
        EstablishmentPrerequisites { transport_established: true, secure_channel_established: true },
    );
    let session = match est {
        SessionEstablishmentResult::Completed(session) => session,
        SessionEstablishmentResult::Rejected(_) => panic!("expected establishment"),
    };
    assert_eq!(session.state, DeliveryState::Discovering);
    assert_eq!(session_established_event(), DeliveryEvent::SessionEstablished);

    // delivery machine mapping (protocol Â§5 steps 1-7)
    let mut state = INITIAL_DELIVERY_STATE;
    for (event, expected) in [
        (DeliveryEvent::DeviceFound, DeliveryState::Available),
        (DeliveryEvent::ConnectInitiated, DeliveryState::Connecting),
        (DeliveryEvent::SecureChannelEstablished, DeliveryState::SecureChannel),
        (DeliveryEvent::SessionEstablished, DeliveryState::SessionEstablished),
    ] {
        match transition(state, event) {
            DeliveryTransition::Accepted(next) => assert_eq!(next, expected),
            DeliveryTransition::Rejected { .. } => panic!("valid transition rejected"),
        }
        state = expected;
    }
    assert_eq!(state, DeliveryState::SessionEstablished);
}

#[test]
fn refused_connection_flow_is_connection_lost() {
    let mut connection = ConnectionAttempt::new();
    connection.begin();
    assert_eq!(connection.complete(ConnectionOutcome::Refused), Some(DeliveryEvent::ConnectionLost));
    assert_eq!(connection.phase(), ConnectionPhase::Failed);
    assert_eq!(connection.events(), vec![DeliveryEvent::ConnectInitiated, DeliveryEvent::ConnectionLost]);

    match transition(DeliveryState::Connecting, DeliveryEvent::ConnectionLost) {
        DeliveryTransition::Accepted(next) => assert_eq!(next, DeliveryState::Failed),
        DeliveryTransition::Rejected { .. } => panic!("connection lost must be accepted"),
    }
}

#[test]
fn connection_lost_drives_reached_stages_to_failed() {
    for state in [
        DeliveryState::Connecting,
        DeliveryState::SecureChannel,
        DeliveryState::SessionEstablished,
    ] {
        match transition(state, DeliveryEvent::ConnectionLost) {
            DeliveryTransition::Accepted(next) => assert_eq!(next, DeliveryState::Failed),
            DeliveryTransition::Rejected { .. } => panic!("connection lost must be accepted"),
        }
    }
    assert!(is_delivery_terminal(DeliveryState::Failed));
    assert!(matches!(
        transition(DeliveryState::Failed, DeliveryEvent::ConnectionLost),
        DeliveryTransition::Rejected { .. }
    ));
}

#[test]
fn networking_layers_map_only_into_defined_delivery_events() {
    // Every event the networking foundation can emit is a defined DeliveryEvent.
    let emitted = vec![
        DeliveryEvent::DeviceFound,
        DeliveryEvent::ConnectInitiated,
        DeliveryEvent::SecureChannelEstablished,
        DeliveryEvent::SessionEstablished,
        DeliveryEvent::ConnectionLost,
    ];
    for event in &emitted {
        assert!(ALL_DELIVERY_EVENTS.contains(event));
    }
}

// --------------------------------------------------------------------------
// Phase 06 — wire transfer messages (spec §19, §24)
// --------------------------------------------------------------------------

fn transfer_id() -> TransferId {
    TransferId::new("tr_01JTEST").unwrap()
}

#[test]
fn round_trip_transfer_progress() {
    let progress = TransferProgress {
        transfer_id: transfer_id(),
        bytes_transferred: 14_800_000,
        total_bytes: 26_004_608,
    };
    let msg = ControlMessage::TransferProgress(progress.clone());
    let json = encode_message(&msg, &default_limits()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "transfer_progress");
    assert_eq!(v["transfer_id"], "tr_01JTEST");
    assert_eq!(v["bytes_transferred"], 14_800_000);
    assert_eq!(v["total_bytes"], 26_004_608);
    assert_eq!(decode_message(&json, &default_limits()).unwrap(), msg);
}

#[test]
fn round_trip_transfer_cancel() {
    let cancel = TransferCancel { transfer_id: transfer_id() };
    let msg = ControlMessage::TransferCancel(cancel.clone());
    let json = encode_message(&msg, &default_limits()).unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "transfer_cancel");
    assert_eq!(decode_message(&json, &default_limits()).unwrap(), msg);
}

#[test]
fn reject_invalid_transfer_messages() {
    // Negative counters.
    let progress = TransferProgress {
        transfer_id: transfer_id(),
        bytes_transferred: -1,
        total_bytes: 26_004_608,
    };
    let msg = ControlMessage::TransferProgress(progress);
    assert_eq!(msg.validate(&default_limits()).unwrap_err().code, ErrorCode::InvalidRequest);

    // Progress beyond the declared total.
    let progress = TransferProgress {
        transfer_id: transfer_id(),
        bytes_transferred: 30_000_000,
        total_bytes: 26_004_608,
    };
    assert!(ControlMessage::TransferProgress(progress).validate(&default_limits()).is_err());

    // Invalid transfer_id is rejected by the TransferId newtype (wire decode).
    assert!(TransferId::new("../tr").is_err());

    // Unknown extra fields are rejected by deny_unknown_fields.
    let bad = r#"{"type":"transfer_progress","transfer_id":"tr_01JTEST","bytes_transferred":100,"total_bytes":200,"extra":true}"#;
    assert!(decode_message(bad, &default_limits()).is_err());
}

#[test]
fn transfer_progress_matches_fixture() {
    let progress = TransferProgress {
        transfer_id: transfer_id(),
        bytes_transferred: 14_800_000,
        total_bytes: 26_004_608,
    };
    assert_eq!(calculate_transfer_progress(progress.bytes_transferred, progress.total_bytes), 56);
}

// --------------------------------------------------------------------------
// Phase 06 — Delivery Engine (protocol spec §8-§26)
// --------------------------------------------------------------------------

fn engine() -> DeliveryEngine {
    DeliveryEngine::new(SessionId::new("sess_01JTEST").unwrap())
}

fn accept_response() -> DeliveryResponse {
    DeliveryResponse {
        request_id: RequestId::new("req_01JTEST").unwrap(),
        decision: Decision::Accept,
    }
}

fn reject_response() -> DeliveryResponse {
    DeliveryResponse {
        request_id: RequestId::new("req_01JTEST").unwrap(),
        decision: Decision::Reject,
    }
}

#[test]
fn helpers_are_consistent() {
    assert_eq!(decision_event(Decision::Accept), DeliveryEvent::Accepted);
    assert_eq!(decision_event(Decision::Reject), DeliveryEvent::Rejected);
    let resp = create_delivery_response(&RequestId::new("req_01JTEST").unwrap(), Decision::Reject);
    assert_eq!(resp.decision, Decision::Reject);
    assert_eq!(calculate_transfer_progress(0, 100), 0);
    assert_eq!(calculate_transfer_progress(150, 100), 100);
    assert_eq!(calculate_transfer_progress(10, 0), 0);
}

#[test]
fn engine_rejects_a_request_for_another_session() {
    let mut e = engine();
    let mut foreign = valid_request();
    foreign.session_id = SessionId::new("sess_OTHER").unwrap();
    let out = e.receive_incoming_request(foreign);
    assert!(!out.ok);
    assert_eq!(out.problem, Some(DeliveryProblem::RequestMismatch));
    assert_eq!(e.state(), DeliveryState::SessionEstablished);
}

#[test]
fn sender_happy_path_reaches_verifying() {
    let mut e = engine();
    let steps: [(&str, DeliveryEvent, DeliveryState); 6] = [
        ("register", DeliveryEvent::RequestSent, DeliveryState::RequestSent),
        ("await", DeliveryEvent::AwaitingDecision, DeliveryState::WaitingForDecision),
        ("accept", DeliveryEvent::Accepted, DeliveryState::Accepted),
        ("prepare", DeliveryEvent::TransferPrepared, DeliveryState::TransferPreparing),
        ("begin", DeliveryEvent::TransferStarted, DeliveryState::Transferring),
        ("complete", DeliveryEvent::VerificationInitiated, DeliveryState::Verifying),
    ];
    let mut transferred = 0i64;
    for (name, event, next) in steps {
        let out = match name {
            "register" => e.register_delivery_request(valid_request()),
            "await" => e.await_decision(),
            "accept" => e.process_response(accept_response()),
            "prepare" => e.prepare_transfer(),
            "begin" => e.begin_transfer(transfer_id()),
            "complete" => e.complete_transfer(),
            _ => panic!("unknown step"),
        };
        if name == "begin" {
            assert!(out.ok);
            // The application layer streams the declared bytes before completion.
            transferred = e.declared_size();
            assert_eq!(e.record_bytes(transferred).ok, true);
            continue;
        }
        assert!(out.ok, "{} failed", name);
        assert_eq!(out.event, Some(event));
        assert_eq!(e.state(), next);
    }
    // Integrity verification and installation are the next repository phase.
    assert_eq!(e.state(), DeliveryState::Verifying);
    assert_eq!(e.bytes_transferred(), transferred);
}

#[test]
fn receiver_happy_path_uses_send_decision_and_reaches_verifying() {
    let mut e = engine();
    assert!(e.receive_incoming_request(valid_request()).ok);
    assert_eq!(e.state(), DeliveryState::RequestSent);
    assert!(e.await_decision().ok);
    let out = e.send_decision(Decision::Accept);
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Accepted));
    match out.action {
        DeliveryAction::SendMessage(ControlMessage::DeliveryResponse(_)) => {}
        other => panic!("expected a delivery_response action, got {:?}", other),
    }
    assert!(e.prepare_transfer().ok);
    assert!(e.begin_transfer(transfer_id()).ok);
    assert!(e.record_bytes(e.declared_size()).ok);
    assert!(e.complete_transfer().ok);
    assert_eq!(e.state(), DeliveryState::Verifying);
}

#[test]
fn send_decision_rejects_sends_delivery_response_too() {
    let mut e = engine();
    e.receive_incoming_request(valid_request());
    e.await_decision();
    let out = e.send_decision(Decision::Reject);
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Rejected));
    match out.action {
        DeliveryAction::SendMessage(ControlMessage::DeliveryResponse(resp)) => {
            assert_eq!(resp.decision, Decision::Reject)
        }
        other => panic!("expected a delivery_response action, got {:?}", other),
    }
    assert_eq!(e.state(), DeliveryState::Rejected);
}

#[test]
fn rejection_path() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    let out = e.process_response(reject_response());
    assert!(out.ok);
    assert_eq!(e.state(), DeliveryState::Rejected);
}

#[test]
fn expiration_requires_waiting_for_decision() {
    let mut e = engine();
    assert_eq!(e.expire().problem, Some(DeliveryProblem::InvalidState));
    e.register_delivery_request(valid_request());
    e.await_decision();
    let out = e.expire();
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Expired));
    assert_eq!(e.state(), DeliveryState::Failed);
    assert_eq!(out.action, DeliveryAction::Cleanup);
}

#[test]
fn cancellation_during_prepare() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    e.process_response(accept_response());
    assert_eq!(e.state(), DeliveryState::Accepted);
    let out = e.cancel();
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Cancelled));
    assert_eq!(e.state(), DeliveryState::Cancelled);
    assert_eq!(out.action, DeliveryAction::Cleanup);
}

#[test]
fn connection_loss_at_every_live_stage_routes_to_failed() {
    let setups: [(&str, fn(&mut DeliveryEngine) -> DeliveryState); 5] = [
        ("request_sent", |e| { e.register_delivery_request(valid_request()); e.state() }),
        ("awaiting_decision", |e| { e.register_delivery_request(valid_request()); e.await_decision(); e.state() }),
        ("accepted", |e| { e.register_delivery_request(valid_request()); e.await_decision(); e.process_response(accept_response()); e.state() }),
        ("transfer_prepared", |e| { e.register_delivery_request(valid_request()); e.await_decision(); e.process_response(accept_response()); e.prepare_transfer(); e.state() }),
        ("transfer_started", |e| { e.register_delivery_request(valid_request()); e.await_decision(); e.process_response(accept_response()); e.prepare_transfer(); e.begin_transfer(transfer_id()); e.state() }),
    ];
    for (_name, setup) in setups {
        let mut e = engine();
        let _ = setup(&mut e);
        let out = e.connection_lost();
        assert!(out.ok, "connection_lost from {:?}", e.state());
        assert_eq!(e.state(), DeliveryState::Failed);
    }
}

#[test]
fn transfer_timeout_during_transfer() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    e.process_response(accept_response());
    e.prepare_transfer();
    e.begin_transfer(transfer_id());
    assert_eq!(e.state(), DeliveryState::Transferring);
    let out = e.transfer_timeout();
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::TransferTimedOut));
    assert_eq!(e.state(), DeliveryState::Failed);
    assert_eq!(out.action, DeliveryAction::Cleanup);
}

#[test]
fn size_enforcement_guards_byte_accounting() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    e.process_response(accept_response());
    e.prepare_transfer();
    e.begin_transfer(transfer_id());

    assert_eq!(e.record_bytes(0).problem, Some(DeliveryProblem::InvalidBytes));
    assert_eq!(e.record_bytes(-1).problem, Some(DeliveryProblem::InvalidBytes));
    assert_eq!(e.record_bytes(e.declared_size() + 1).problem, Some(DeliveryProblem::SizeExceeded));
    assert_eq!(e.bytes_transferred(), 0);

    // Premature EOF: completing short fails with SIZE_MISMATCH.
    assert_eq!(e.record_bytes(e.declared_size() - 1).ok, true);
    assert_eq!(e.complete_transfer().problem, Some(DeliveryProblem::SizeMismatch));
    assert_eq!(e.state(), DeliveryState::Transferring);

    // Full byte count completes.
    assert_eq!(e.record_bytes(1).ok, true);
    assert_eq!(e.bytes_transferred(), e.declared_size());
    assert_eq!(e.progress_percent(), 100);
    let out = e.complete_transfer();
    assert!(out.ok);
    assert_eq!(e.state(), DeliveryState::Verifying);
}

#[test]
fn duplicate_decision_is_rejected_without_state_corruption() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    let out = e.process_response(accept_response());
    assert!(out.ok);
    assert_eq!(e.state(), DeliveryState::Accepted);
    assert_eq!(e.process_response(accept_response()).problem, Some(DeliveryProblem::InvalidState));
    assert_eq!(e.state(), DeliveryState::Accepted);
}

#[test]
fn response_mismatch_is_rejected() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    let mut wrong = accept_response();
    wrong.request_id = RequestId::new("req_OTHER").unwrap();
    assert_eq!(e.process_response(wrong).problem, Some(DeliveryProblem::ResponseMismatch));
    assert_eq!(e.state(), DeliveryState::WaitingForDecision);
}

#[test]
fn process_transfer_cancel_checks_identity() {
    let mut e = engine();
    e.register_delivery_request(valid_request());
    e.await_decision();
    e.process_response(accept_response());
    e.prepare_transfer();
    e.begin_transfer(transfer_id());

    let other = TransferId::new("tr_OTHER").unwrap();
    assert_eq!(e.process_transfer_cancel(other).problem, Some(DeliveryProblem::TransferIdMismatch));

    let out = e.process_transfer_cancel(transfer_id());
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Cancelled));
    assert_eq!(e.state(), DeliveryState::Cancelled);
    assert_eq!(out.action, DeliveryAction::StopStream);
}

#[test]
fn terminal_states_remain_terminal() {
    for terminal in [DeliveryState::Completed, DeliveryState::Rejected, DeliveryState::Failed, DeliveryState::Cancelled] {
        let mut e = DeliveryEngine::with_state(SessionId::new("sess_01JTEST").unwrap(), terminal);
        assert_eq!(e.register_delivery_request(valid_request()).problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.await_decision().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.process_response(accept_response()).problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.expire().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.cancel().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.prepare_transfer().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.begin_transfer(transfer_id()).problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.complete_transfer().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.transfer_timeout().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.connection_lost().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.process_transfer_cancel(transfer_id()).problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.record_bytes(1).problem, Some(DeliveryProblem::InvalidState));
    }
}

#[test]
fn event_sequence_is_deterministic_and_mirror_equal() {
    let run = |sender: bool| -> Vec<DeliveryEvent> {
        let mut e = engine();
        let mut events = Vec::new();
        let mut note = |out: &DeliveryOutcome| {
            if out.ok {
                if let Some(event) = out.event {
                    events.push(event);
                }
            }
        };
        if sender {
            note(&e.register_delivery_request(valid_request()));
        } else {
            note(&e.receive_incoming_request(valid_request()));
        }
        note(&e.await_decision());
        if sender {
            note(&e.process_response(accept_response()));
        } else {
            note(&e.send_decision(Decision::Accept));
        }
        note(&e.prepare_transfer());
        note(&e.begin_transfer(transfer_id()));
        e.record_bytes(e.declared_size());
        note(&e.complete_transfer());
        events
    };
    let expected = vec![
        DeliveryEvent::RequestSent,
        DeliveryEvent::AwaitingDecision,
        DeliveryEvent::Accepted,
        DeliveryEvent::TransferPrepared,
        DeliveryEvent::TransferStarted,
        DeliveryEvent::VerificationInitiated,
    ];
    assert_eq!(run(true), expected);
    assert_eq!(run(false), expected);
}

// --------------------------------------------------------------------------
// Phase 07 — Integrity verification & installation handoff (spec §20-§23,
// project spec §14/§24/§26)
// --------------------------------------------------------------------------

const EXPECTED_DIGEST: &str =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const OTHER_DIGEST: &str =
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

fn to_verifying() -> DeliveryEngine {
    let mut e = engine();
    assert!(e.register_delivery_request(valid_request()).ok);
    assert!(e.await_decision().ok);
    assert!(e.process_response(accept_response()).ok);
    assert!(e.prepare_transfer().ok);
    assert!(e.begin_transfer(transfer_id()).ok);
    let declared = e.declared_size();
    assert!(e.record_bytes(declared).ok);
    assert!(e.complete_transfer().ok);
    assert_eq!(e.state(), DeliveryState::Verifying);
    e
}

fn to_verified() -> DeliveryEngine {
    let mut e = to_verifying();
    assert_eq!(e.expected_digest(), Some(EXPECTED_DIGEST));
    let out = e.complete_verification(EXPECTED_DIGEST);
    assert!(out.ok);
    assert_eq!(e.state(), DeliveryState::Verified);
    e
}

fn to_install_ready() -> DeliveryEngine {
    let mut e = to_verified();
    assert!(e.prepare_install().ok);
    assert_eq!(e.state(), DeliveryState::InstallReady);
    e
}

fn to_handoff() -> DeliveryEngine {
    let mut e = to_install_ready();
    assert!(e.handoff_install().ok);
    assert_eq!(e.state(), DeliveryState::InstallationHandoff);
    e
}

#[test]
fn verification_success_reaches_verified() {
    let mut e = to_verifying();
    let out = e.complete_verification(EXPECTED_DIGEST);
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Verified));
    assert_eq!(out.to, Some(DeliveryState::Verified));
    assert_eq!(out.action, DeliveryAction::None);
    assert_eq!(out.problem, None);
    assert_eq!(e.state(), DeliveryState::Verified);
}

#[test]
fn verification_is_case_insensitive() {
    let mut e = to_verifying();
    let upper = EXPECTED_DIGEST.to_uppercase();
    let out = e.complete_verification(&upper);
    assert!(out.ok);
    assert_eq!(e.state(), DeliveryState::Verified);
}

#[test]
fn verification_mismatch_fails_with_cleanup() {
    let mut e = to_verifying();
    let out = e.complete_verification(OTHER_DIGEST);
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::IntegrityMismatch));
    assert_eq!(out.to, Some(DeliveryState::Failed));
    assert_eq!(out.action, DeliveryAction::Cleanup);
    assert_eq!(out.problem, Some(DeliveryProblem::IntegrityMismatch));
    assert_eq!(e.state(), DeliveryState::Failed);
}

#[test]
fn verification_rejects_malformed_digest() {
    let mut e = to_verifying();
    assert_eq!(e.complete_verification("not-a-digest").problem, Some(DeliveryProblem::InvalidDigest));
    assert_eq!(e.complete_verification("abc").problem, Some(DeliveryProblem::InvalidDigest));
    assert_eq!(e.state(), DeliveryState::Verifying);
}

#[test]
fn verification_requires_request_and_state() {
    let mut bare = DeliveryEngine::with_state(
        SessionId::new("sess_01JTEST").unwrap(),
        DeliveryState::Verifying,
    );
    assert_eq!(bare.complete_verification(EXPECTED_DIGEST).problem, Some(DeliveryProblem::NoRequest));

    let mut advanced = to_verified();
    assert_eq!(advanced.complete_verification(EXPECTED_DIGEST).problem, Some(DeliveryProblem::InvalidState));
}

#[test]
fn prepare_install_and_handoff_invoke_installer() {
    let mut e = to_verified();
    let prepared = e.prepare_install();
    assert!(prepared.ok);
    assert_eq!(prepared.event, Some(DeliveryEvent::InstallPrepared));
    assert_eq!(e.state(), DeliveryState::InstallReady);
    assert_eq!(e.prepare_install().problem, Some(DeliveryProblem::InvalidState));

    let handoff = e.handoff_install();
    assert!(handoff.ok);
    assert_eq!(handoff.event, Some(DeliveryEvent::HandoffInitiated));
    assert_eq!(handoff.to, Some(DeliveryState::InstallationHandoff));
    assert_eq!(handoff.action, DeliveryAction::InvokeInstaller);
    assert_eq!(e.state(), DeliveryState::InstallationHandoff);
}

#[test]
fn installation_completed_reaches_completed() {
    let mut e = to_handoff();
    let out = e.installation_completed();
    assert!(out.ok);
    assert_eq!(out.event, Some(DeliveryEvent::Completed));
    assert_eq!(out.to, Some(DeliveryState::Completed));
    assert_eq!(out.action, DeliveryAction::Cleanup);
    assert_eq!(e.state(), DeliveryState::Completed);
    assert_eq!(e.installation_completed().problem, Some(DeliveryProblem::InvalidState));
}

#[test]
fn installation_unavailable_fails_before_and_during_handoff() {
    let mut ready = to_install_ready();
    let before = ready.installation_unavailable();
    assert!(before.ok);
    assert_eq!(before.event, Some(DeliveryEvent::InstallationUnavailable));
    assert_eq!(before.to, Some(DeliveryState::Failed));
    assert_eq!(before.action, DeliveryAction::Cleanup);
    assert_eq!(ready.state(), DeliveryState::Failed);

    let mut handoff = to_handoff();
    let during = handoff.installation_unavailable();
    assert!(during.ok);
    assert_eq!(during.event, Some(DeliveryEvent::InstallationUnavailable));
    assert_eq!(during.to, Some(DeliveryState::Failed));
    assert_eq!(handoff.state(), DeliveryState::Failed);
}

#[test]
fn installation_unavailable_requires_install_stage() {
    let mut e = to_verified();
    assert_eq!(e.installation_unavailable().problem, Some(DeliveryProblem::InvalidState));
}

#[test]
fn machine_stays_frozen_in_install_stages() {
    let mut handoff = to_handoff();
    let cancel = handoff.cancel();
    assert!(!cancel.ok);
    assert_eq!(cancel.problem, Some(DeliveryProblem::InvalidTransition));
    assert_eq!(handoff.state(), DeliveryState::InstallationHandoff);

    let mut verified = to_verified();
    let lost = verified.connection_lost();
    assert!(!lost.ok);
    assert_eq!(lost.problem, Some(DeliveryProblem::InvalidTransition));
    assert_eq!(verified.state(), DeliveryState::Verified);
}

#[test]
fn cancellation_still_works_from_verified_and_ready() {
    let mut from_verified = to_verified();
    assert!(from_verified.cancel().ok);
    assert_eq!(from_verified.state(), DeliveryState::Cancelled);

    let mut from_ready = to_install_ready();
    assert!(from_ready.cancel().ok);
    assert_eq!(from_ready.state(), DeliveryState::Cancelled);
}

#[test]
fn full_receiver_lifecycle_completes() {
    let mut e = to_verifying();
    let upper = EXPECTED_DIGEST.to_uppercase();
    assert!(e.complete_verification(&upper).ok);
    assert!(e.prepare_install().ok);
    assert!(e.handoff_install().ok);
    let done = e.installation_completed();
    assert!(done.ok);
    assert_eq!(e.state(), DeliveryState::Completed);
    assert_eq!(e.complete_verification(EXPECTED_DIGEST).problem, Some(DeliveryProblem::InvalidState));
    assert_eq!(e.prepare_install().problem, Some(DeliveryProblem::InvalidState));
    assert_eq!(e.handoff_install().problem, Some(DeliveryProblem::InvalidState));
    assert_eq!(e.installation_unavailable().problem, Some(DeliveryProblem::InvalidState));
}

#[test]
fn new_ops_rejected_from_every_terminal_state() {
    for terminal in [DeliveryState::Completed, DeliveryState::Rejected, DeliveryState::Failed, DeliveryState::Cancelled] {
        let mut e = DeliveryEngine::with_state(SessionId::new("sess_01JTEST").unwrap(), terminal);
        assert_eq!(e.complete_verification(EXPECTED_DIGEST).problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.prepare_install().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.handoff_install().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.installation_completed().problem, Some(DeliveryProblem::InvalidState));
        assert_eq!(e.installation_unavailable().problem, Some(DeliveryProblem::InvalidState));
    }
}
