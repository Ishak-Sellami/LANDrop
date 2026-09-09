// Connection lifecycle foundation (protocol spec §5, project spec §15,
// architecture §28/§29/§31). ONE deterministic connection attempt per
// lifecycle; no automatic reconnection, pooling, load balancing, NAT
// traversal, or proxying. The platform seam maps socket outcomes into
// ConnectionOutcome; this module maps them into TransportFailure and the
// existing DeliveryEvents. Networking layers only ever emit the events the
// delivery state machine already defines.

use super::{DeliveryEvent, TransportErrorKind, TransportFailure};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionOutcome {
    Established,
    Refused,
    Timeout,
    Closed,
    IoError,
}

pub const CONNECTION_OUTCOMES: [ConnectionOutcome; 5] = [
    ConnectionOutcome::Established,
    ConnectionOutcome::Refused,
    ConnectionOutcome::Timeout,
    ConnectionOutcome::Closed,
    ConnectionOutcome::IoError,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionPhase {
    Idle,
    Connecting,
    Established,
    Failed,
    Closed,
}

// Fixture-driven failure mapping (protocol spec §27 CONNECTION_LOST,
// architecture §31 transport errors). No new wire ErrorCodes.
pub fn connection_failure(outcome: ConnectionOutcome) -> TransportFailure {
    match outcome {
        ConnectionOutcome::Established => {
            panic!("connection_failure requires a failing outcome")
        }
        ConnectionOutcome::Refused => TransportFailure {
            kind: TransportErrorKind::IoError,
            message: "connection refused".to_string(),
        },
        ConnectionOutcome::Timeout => TransportFailure {
            kind: TransportErrorKind::Timeout,
            message: "connection timed out".to_string(),
        },
        ConnectionOutcome::Closed => TransportFailure {
            kind: TransportErrorKind::ConnectionLost,
            message: "connection closed".to_string(),
        },
        ConnectionOutcome::IoError => TransportFailure {
            kind: TransportErrorKind::IoError,
            message: "transport I/O error".to_string(),
        },
    }
}

// Deterministic single-attempt connection lifecycle.
// - begin(): Idle -> Connecting, emits ConnectInitiated.
// - complete(outcome): Connecting -> Established (no delivery event) or ->
//   Failed (emits ConnectionLost once). Completed attempts are finalized:
//   repeated complete() is a no-op.
// - close(): Connecting|Established -> Closed, emits ConnectionLost once;
//   idempotent from any terminal phase (architecture §31, fixture close case).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ConnectionAttempt {
    phase: ConnectionPhase,
    emitted: Vec<DeliveryEvent>,
    failure: Option<TransportFailure>,
}

impl ConnectionAttempt {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn phase(&self) -> ConnectionPhase {
        self.phase
    }

    pub fn last_failure(&self) -> Option<&TransportFailure> {
        self.failure.as_ref()
    }

    pub fn begin(&mut self) -> Option<DeliveryEvent> {
        if self.phase != ConnectionPhase::Idle {
            return None;
        }
        self.phase = ConnectionPhase::Connecting;
        self.emitted.push(DeliveryEvent::ConnectInitiated);
        Some(DeliveryEvent::ConnectInitiated)
    }

    pub fn complete(&mut self, outcome: ConnectionOutcome) -> Option<DeliveryEvent> {
        if self.phase != ConnectionPhase::Connecting {
            return None;
        }
        if outcome == ConnectionOutcome::Established {
            self.phase = ConnectionPhase::Established;
            return None;
        }
        self.phase = ConnectionPhase::Failed;
        self.failure = Some(connection_failure(outcome));
        self.emitted.push(DeliveryEvent::ConnectionLost);
        Some(DeliveryEvent::ConnectionLost)
    }

    pub fn close(&mut self) -> Option<DeliveryEvent> {
        if self.phase != ConnectionPhase::Connecting && self.phase != ConnectionPhase::Established {
            return None;
        }
        self.phase = ConnectionPhase::Closed;
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
            CONNECTION_OUTCOMES,
            [
                ConnectionOutcome::Established,
                ConnectionOutcome::Refused,
                ConnectionOutcome::Timeout,
                ConnectionOutcome::Closed,
                ConnectionOutcome::IoError,
            ]
        );
    }

    #[test]
    fn begin_emits_connect_initiated_once() {
        let mut attempt = ConnectionAttempt::new();
        assert_eq!(attempt.begin(), Some(DeliveryEvent::ConnectInitiated));
        assert_eq!(attempt.phase(), ConnectionPhase::Connecting);
        assert_eq!(attempt.begin(), None);
        assert_eq!(attempt.events(), vec![DeliveryEvent::ConnectInitiated]);
    }

    #[test]
    fn establishes_without_emitting_a_delivery_event() {
        let mut attempt = ConnectionAttempt::new();
        attempt.begin();
        assert_eq!(attempt.complete(ConnectionOutcome::Established), None);
        assert_eq!(attempt.phase(), ConnectionPhase::Established);
        assert!(attempt.last_failure().is_none());
    }

    #[test]
    fn maps_every_connection_failure_per_fixture() {
        let cases: [(ConnectionOutcome, TransportErrorKind, &str); 4] = [
            (ConnectionOutcome::Refused, TransportErrorKind::IoError, "connection refused"),
            (ConnectionOutcome::Timeout, TransportErrorKind::Timeout, "connection timed out"),
            (ConnectionOutcome::Closed, TransportErrorKind::ConnectionLost, "connection closed"),
            (ConnectionOutcome::IoError, TransportErrorKind::IoError, "transport I/O error"),
        ];
        for (outcome, kind, message) in cases {
            let failure = connection_failure(outcome);
            assert_eq!(failure.kind, kind);
            assert_eq!(failure.message, message);
        }
    }

    #[test]
    fn failing_an_attempt_emits_connection_lost_once() {
        for outcome in [
            ConnectionOutcome::Refused,
            ConnectionOutcome::Timeout,
            ConnectionOutcome::Closed,
            ConnectionOutcome::IoError,
        ] {
            let mut attempt = ConnectionAttempt::new();
            attempt.begin();
            assert_eq!(attempt.complete(outcome), Some(DeliveryEvent::ConnectionLost));
            assert_eq!(attempt.phase(), ConnectionPhase::Failed);
            assert_eq!(attempt.last_failure(), Some(&connection_failure(outcome)));
            assert_eq!(attempt.complete(outcome), None);
            assert_eq!(attempt.events(), vec![DeliveryEvent::ConnectInitiated, DeliveryEvent::ConnectionLost]);
        }
    }

    #[test]
    fn established_connection_is_finalized() {
        let mut attempt = ConnectionAttempt::new();
        attempt.begin();
        attempt.complete(ConnectionOutcome::Established);
        assert_eq!(attempt.complete(ConnectionOutcome::Established), None);
        assert_eq!(attempt.complete(ConnectionOutcome::Refused), None);
        assert_eq!(attempt.phase(), ConnectionPhase::Established);
    }

    #[test]
    fn close_is_deterministic_and_idempotent() {
        for final_phase in [ConnectionPhase::Connecting, ConnectionPhase::Established] {
            let mut attempt = ConnectionAttempt::new();
            attempt.begin();
            if final_phase == ConnectionPhase::Established {
                attempt.complete(ConnectionOutcome::Established);
            }
            assert_eq!(attempt.close(), Some(DeliveryEvent::ConnectionLost));
            assert_eq!(attempt.phase(), ConnectionPhase::Closed);
            assert_eq!(attempt.close(), None);
        }
        let mut failed = ConnectionAttempt::new();
        failed.begin();
        failed.complete(ConnectionOutcome::Timeout);
        assert_eq!(failed.close(), None);
    }

    #[test]
    fn reproduces_fixture_connection_cases_deterministically() {
        let run = |scenario: &dyn Fn(&mut ConnectionAttempt)| {
            let mut attempt = ConnectionAttempt::new();
            scenario(&mut attempt);
            attempt.events()
        };
        let established_then_lost = |attempt: &mut ConnectionAttempt| {
            attempt.begin();
            attempt.complete(ConnectionOutcome::Established);
            attempt.close();
        };
        let refused = |attempt: &mut ConnectionAttempt| {
            attempt.begin();
            attempt.complete(ConnectionOutcome::Refused);
        };
        let timeout = |attempt: &mut ConnectionAttempt| {
            attempt.begin();
            attempt.complete(ConnectionOutcome::Timeout);
        };
        let io_error = |attempt: &mut ConnectionAttempt| {
            attempt.begin();
            attempt.complete(ConnectionOutcome::IoError);
        };
        let mut scenarios: Vec<(String, &dyn Fn(&mut ConnectionAttempt), Vec<DeliveryEvent>)> = vec![
            (
                "established_then_lost".to_string(),
                &established_then_lost,
                vec![DeliveryEvent::ConnectInitiated, DeliveryEvent::ConnectionLost],
            ),
            (
                "refused".to_string(),
                &refused,
                vec![DeliveryEvent::ConnectInitiated, DeliveryEvent::ConnectionLost],
            ),
            (
                "timeout".to_string(),
                &timeout,
                vec![DeliveryEvent::ConnectInitiated, DeliveryEvent::ConnectionLost],
            ),
            (
                "io_error".to_string(),
                &io_error,
                vec![DeliveryEvent::ConnectInitiated, DeliveryEvent::ConnectionLost],
            ),
        ];
        for (name, scenario, expected) in scenarios.drain(..) {
            assert_eq!(run(scenario), expected, "{name}");
            assert_eq!(run(scenario), expected, "{name} replay");
        }
    }
}