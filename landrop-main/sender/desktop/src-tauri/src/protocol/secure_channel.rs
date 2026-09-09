// Secure-channel (TLS) lifecycle foundation (protocol spec §3/§5, project
// spec §15, architecture §28/§31). TLS 1.3 is implemented by the platform
// runtime only — no custom cryptography, no invented certificate model. The
// certificate/trust policy for LanDrop peers is a SPECIFICATION GAP (protocol
// §39 defers pairing/trust); validation failure therefore surfaces the
// platform default result and is never silently weakened. This module is
// deterministic and I/O-free: it classifies platform handshake outcomes into
// transport failures and the existing DeliveryEvents.

use super::{DeliveryEvent, TransportErrorKind, TransportFailure};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecureChannelOutcome {
    Established,
    HandshakeFailure,
    ValidationFailure,
    Timeout,
    Closed,
}

pub const SECURE_CHANNEL_OUTCOMES: [SecureChannelOutcome; 5] = [
    SecureChannelOutcome::Established,
    SecureChannelOutcome::HandshakeFailure,
    SecureChannelOutcome::ValidationFailure,
    SecureChannelOutcome::Timeout,
    SecureChannelOutcome::Closed,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecureChannelPhase {
    Idle,
    Tls,
    Established,
    Failed,
    Closed,
}

pub fn secure_channel_failure(outcome: SecureChannelOutcome) -> TransportFailure {
    match outcome {
        SecureChannelOutcome::Established => {
            panic!("secure_channel_failure requires a failing outcome")
        }
        SecureChannelOutcome::HandshakeFailure => TransportFailure {
            kind: TransportErrorKind::IoError,
            message: "TLS handshake failed".to_string(),
        },
        SecureChannelOutcome::ValidationFailure => TransportFailure {
            kind: TransportErrorKind::IoError,
            message: "certificate validation failed (trust model undefined)".to_string(),
        },
        SecureChannelOutcome::Timeout => TransportFailure {
            kind: TransportErrorKind::Timeout,
            message: "TLS handshake timed out".to_string(),
        },
        SecureChannelOutcome::Closed => TransportFailure {
            kind: TransportErrorKind::ConnectionLost,
            message: "connection closed during TLS handshake".to_string(),
        },
    }
}

// Deterministic TLS-handshake lifecycle over an already-open transport.
// - begin(): Idle -> Tls. No delivery event is emitted: the delivery machine
//   stays in Connecting while the handshake runs.
// - complete(outcome): Established -> emits SecureChannelEstablished; any
//   failure -> emits ConnectionLost once (deterministic failure propagation).
//   Repeated completion is a no-op.
// - close(): aborts a running handshake -> ConnectionLost once; idempotent.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct SecureChannelAttempt {
    phase: SecureChannelPhase,
    emitted: Vec<DeliveryEvent>,
    failure: Option<TransportFailure>,
}

impl SecureChannelAttempt {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn phase(&self) -> SecureChannelPhase {
        self.phase
    }

    pub fn last_failure(&self) -> Option<&TransportFailure> {
        self.failure.as_ref()
    }

    pub fn begin(&mut self) -> Option<DeliveryEvent> {
        if self.phase == SecureChannelPhase::Idle {
            self.phase = SecureChannelPhase::Tls;
        }
        None
    }

    pub fn complete(&mut self, outcome: SecureChannelOutcome) -> Option<DeliveryEvent> {
        if self.phase != SecureChannelPhase::Tls {
            return None;
        }
        if outcome == SecureChannelOutcome::Established {
            self.phase = SecureChannelPhase::Established;
            self.emitted.push(DeliveryEvent::SecureChannelEstablished);
            return Some(DeliveryEvent::SecureChannelEstablished);
        }
        self.phase = SecureChannelPhase::Failed;
        self.failure = Some(secure_channel_failure(outcome));
        self.emitted.push(DeliveryEvent::ConnectionLost);
        Some(DeliveryEvent::ConnectionLost)
    }

    pub fn close(&mut self) -> Option<DeliveryEvent> {
        if self.phase != SecureChannelPhase::Tls {
            return None;
        }
        self.phase = SecureChannelPhase::Closed;
        self.emitted.push(DeliveryEvent::ConnectionLost);
        Some(DeliveryEvent::ConnectionLost)
    }

    pub fn events(&self) -> Vec<DeliveryEvent> {
        self.emitted.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_fixture_outcome_vocabulary() {
        assert_eq!(
            SECURE_CHANNEL_OUTCOMES,
            [
                SecureChannelOutcome::Established,
                SecureChannelOutcome::HandshakeFailure,
                SecureChannelOutcome::ValidationFailure,
                SecureChannelOutcome::Timeout,
                SecureChannelOutcome::Closed,
            ]
        );
    }

    #[test]
    fn handshake_phase_emits_no_delivery_event() {
        let mut channel = SecureChannelAttempt::new();
        assert_eq!(channel.begin(), None);
        assert_eq!(channel.phase(), SecureChannelPhase::Tls);
    }

    #[test]
    fn establishes_secure_channel_and_emits_event() {
        let mut channel = SecureChannelAttempt::new();
        channel.begin();
        assert_eq!(channel.complete(SecureChannelOutcome::Established), Some(DeliveryEvent::SecureChannelEstablished));
        assert_eq!(channel.phase(), SecureChannelPhase::Established);
        assert_eq!(channel.events(), vec![DeliveryEvent::SecureChannelEstablished]);
    }

    #[test]
    fn is_finalized_after_establishment() {
        let mut channel = SecureChannelAttempt::new();
        channel.begin();
        channel.complete(SecureChannelOutcome::Established);
        assert_eq!(channel.complete(SecureChannelOutcome::Established), None);
        assert_eq!(channel.complete(SecureChannelOutcome::Closed), None);
    }

    #[test]
    fn maps_every_tls_failure_per_fixture() {
        let cases: [(SecureChannelOutcome, TransportErrorKind, &str); 4] = [
            (SecureChannelOutcome::HandshakeFailure, TransportErrorKind::IoError, "TLS handshake failed"),
            (
                SecureChannelOutcome::ValidationFailure,
                TransportErrorKind::IoError,
                "certificate validation failed (trust model undefined)",
            ),
            (SecureChannelOutcome::Timeout, TransportErrorKind::Timeout, "TLS handshake timed out"),
            (SecureChannelOutcome::Closed, TransportErrorKind::ConnectionLost, "connection closed during TLS handshake"),
        ];
        for (outcome, kind, message) in cases {
            let failure = secure_channel_failure(outcome);
            assert_eq!(failure.kind, kind);
            assert_eq!(failure.message, message);
        }
    }

    #[test]
    fn failing_handshake_emits_connection_lost_once() {
        for outcome in [
            SecureChannelOutcome::HandshakeFailure,
            SecureChannelOutcome::ValidationFailure,
            SecureChannelOutcome::Timeout,
            SecureChannelOutcome::Closed,
        ] {
            let mut channel = SecureChannelAttempt::new();
            channel.begin();
            assert_eq!(channel.complete(outcome), Some(DeliveryEvent::ConnectionLost));
            assert_eq!(channel.phase(), SecureChannelPhase::Failed);
            assert_eq!(channel.last_failure(), Some(&secure_channel_failure(outcome)));
            assert_eq!(channel.complete(outcome), None);
            assert_eq!(channel.events(), vec![DeliveryEvent::ConnectionLost]);
        }
    }

    #[test]
    fn aborting_handshake_is_deterministic_and_idempotent() {
        let mut channel = SecureChannelAttempt::new();
        channel.begin();
        assert_eq!(channel.close(), Some(DeliveryEvent::ConnectionLost));
        assert_eq!(channel.phase(), SecureChannelPhase::Closed);
        assert_eq!(channel.close(), None);
        assert_eq!(channel.events(), vec![DeliveryEvent::ConnectionLost]);
    }

    #[test]
    fn reproduces_fixture_outcome_to_event_mapping() {
        let cases: [(SecureChannelOutcome, DeliveryEvent); 5] = [
            (SecureChannelOutcome::Established, DeliveryEvent::SecureChannelEstablished),
            (SecureChannelOutcome::HandshakeFailure, DeliveryEvent::ConnectionLost),
            (SecureChannelOutcome::ValidationFailure, DeliveryEvent::ConnectionLost),
            (SecureChannelOutcome::Timeout, DeliveryEvent::ConnectionLost),
            (SecureChannelOutcome::Closed, DeliveryEvent::ConnectionLost),
        ];
        for (outcome, event) in cases {
            let mut channel = SecureChannelAttempt::new();
            channel.begin();
            assert_eq!(channel.complete(outcome), Some(event));
            assert_eq!(channel.events(), vec![event]);
        }
    }
}