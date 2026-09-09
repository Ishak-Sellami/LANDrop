use super::DeliveryState;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryEvent {
    DeviceFound,
    ConnectInitiated,
    SecureChannelEstablished,
    SessionEstablished,
    RequestSent,
    AwaitingDecision,
    Accepted,
    Rejected,
    TransferPrepared,
    TransferStarted,
    VerificationInitiated,
    Verified,
    InstallPrepared,
    HandoffInitiated,
    Completed,
    Cancelled,
    Expired,
    TransferTimedOut,
    ConnectionLost,
    IntegrityMismatch,
    InstallationUnavailable,
}

pub const ALL_DELIVERY_EVENTS: [DeliveryEvent; 21] = [
    DeliveryEvent::DeviceFound,
    DeliveryEvent::ConnectInitiated,
    DeliveryEvent::SecureChannelEstablished,
    DeliveryEvent::SessionEstablished,
    DeliveryEvent::RequestSent,
    DeliveryEvent::AwaitingDecision,
    DeliveryEvent::Accepted,
    DeliveryEvent::Rejected,
    DeliveryEvent::TransferPrepared,
    DeliveryEvent::TransferStarted,
    DeliveryEvent::VerificationInitiated,
    DeliveryEvent::Verified,
    DeliveryEvent::InstallPrepared,
    DeliveryEvent::HandoffInitiated,
    DeliveryEvent::Completed,
    DeliveryEvent::Cancelled,
    DeliveryEvent::Expired,
    DeliveryEvent::TransferTimedOut,
    DeliveryEvent::ConnectionLost,
    DeliveryEvent::IntegrityMismatch,
    DeliveryEvent::InstallationUnavailable,
];

pub const ALL_DELIVERY_STATES: [DeliveryState; 18] = [
    DeliveryState::Discovering,
    DeliveryState::Available,
    DeliveryState::Connecting,
    DeliveryState::SecureChannel,
    DeliveryState::SessionEstablished,
    DeliveryState::RequestSent,
    DeliveryState::WaitingForDecision,
    DeliveryState::Accepted,
    DeliveryState::TransferPreparing,
    DeliveryState::Transferring,
    DeliveryState::Verifying,
    DeliveryState::Verified,
    DeliveryState::InstallReady,
    DeliveryState::InstallationHandoff,
    DeliveryState::Completed,
    DeliveryState::Rejected,
    DeliveryState::Failed,
    DeliveryState::Cancelled,
];

pub const INITIAL_DELIVERY_STATE: DeliveryState = DeliveryState::Discovering;

pub const DELIVERY_TERMINAL_STATES: [DeliveryState; 4] = [
    DeliveryState::Completed,
    DeliveryState::Rejected,
    DeliveryState::Failed,
    DeliveryState::Cancelled,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryTransition {
    Accepted(DeliveryState),
    Rejected { from: DeliveryState, event: DeliveryEvent },
}

pub fn transition(state: DeliveryState, event: DeliveryEvent) -> DeliveryTransition {
    let to = match (state, event) {
        (DeliveryState::Discovering, DeliveryEvent::DeviceFound) => Some(DeliveryState::Available),
        (DeliveryState::Available, DeliveryEvent::ConnectInitiated) => Some(DeliveryState::Connecting),
        (DeliveryState::Connecting, DeliveryEvent::SecureChannelEstablished) => Some(DeliveryState::SecureChannel),
        (DeliveryState::Connecting, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::SecureChannel, DeliveryEvent::SessionEstablished) => Some(DeliveryState::SessionEstablished),
        (DeliveryState::SecureChannel, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::SessionEstablished, DeliveryEvent::RequestSent) => Some(DeliveryState::RequestSent),
        (DeliveryState::SessionEstablished, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::RequestSent, DeliveryEvent::AwaitingDecision) => Some(DeliveryState::WaitingForDecision),
        (DeliveryState::RequestSent, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::WaitingForDecision, DeliveryEvent::Accepted) => Some(DeliveryState::Accepted),
        (DeliveryState::WaitingForDecision, DeliveryEvent::Rejected) => Some(DeliveryState::Rejected),
        (DeliveryState::WaitingForDecision, DeliveryEvent::Expired) => Some(DeliveryState::Failed),
        (DeliveryState::WaitingForDecision, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::Accepted, DeliveryEvent::TransferPrepared) => Some(DeliveryState::TransferPreparing),
        (DeliveryState::Accepted, DeliveryEvent::Cancelled) => Some(DeliveryState::Cancelled),
        (DeliveryState::Accepted, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::TransferPreparing, DeliveryEvent::TransferStarted) => Some(DeliveryState::Transferring),
        (DeliveryState::TransferPreparing, DeliveryEvent::Cancelled) => Some(DeliveryState::Cancelled),
        (DeliveryState::TransferPreparing, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::Transferring, DeliveryEvent::VerificationInitiated) => Some(DeliveryState::Verifying),
        (DeliveryState::Transferring, DeliveryEvent::Cancelled) => Some(DeliveryState::Cancelled),
        (DeliveryState::Transferring, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::Transferring, DeliveryEvent::TransferTimedOut) => Some(DeliveryState::Failed),
        (DeliveryState::Verifying, DeliveryEvent::Verified) => Some(DeliveryState::Verified),
        (DeliveryState::Verifying, DeliveryEvent::Cancelled) => Some(DeliveryState::Cancelled),
        (DeliveryState::Verifying, DeliveryEvent::ConnectionLost) => Some(DeliveryState::Failed),
        (DeliveryState::Verifying, DeliveryEvent::IntegrityMismatch) => Some(DeliveryState::Failed),
        (DeliveryState::Verified, DeliveryEvent::InstallPrepared) => Some(DeliveryState::InstallReady),
        (DeliveryState::Verified, DeliveryEvent::Cancelled) => Some(DeliveryState::Cancelled),
        (DeliveryState::InstallReady, DeliveryEvent::HandoffInitiated) => Some(DeliveryState::InstallationHandoff),
        (DeliveryState::InstallReady, DeliveryEvent::Cancelled) => Some(DeliveryState::Cancelled),
        (DeliveryState::InstallReady, DeliveryEvent::InstallationUnavailable) => Some(DeliveryState::Failed),
        (DeliveryState::InstallationHandoff, DeliveryEvent::Completed) => Some(DeliveryState::Completed),
        (DeliveryState::InstallationHandoff, DeliveryEvent::InstallationUnavailable) => Some(DeliveryState::Failed),
        _ => None,
    };
    match to {
        Some(next) => DeliveryTransition::Accepted(next),
        None => DeliveryTransition::Rejected { from: state, event },
    }
}

pub fn is_delivery_terminal(state: DeliveryState) -> bool {
    DELIVERY_TERMINAL_STATES.contains(&state)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected_table() -> Vec<(DeliveryState, DeliveryEvent, DeliveryState)> {
        vec![
            (DeliveryState::Discovering, DeliveryEvent::DeviceFound, DeliveryState::Available),
            (DeliveryState::Available, DeliveryEvent::ConnectInitiated, DeliveryState::Connecting),
            (DeliveryState::Connecting, DeliveryEvent::SecureChannelEstablished, DeliveryState::SecureChannel),
            (DeliveryState::Connecting, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::SecureChannel, DeliveryEvent::SessionEstablished, DeliveryState::SessionEstablished),
            (DeliveryState::SecureChannel, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::SessionEstablished, DeliveryEvent::RequestSent, DeliveryState::RequestSent),
            (DeliveryState::SessionEstablished, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::RequestSent, DeliveryEvent::AwaitingDecision, DeliveryState::WaitingForDecision),
            (DeliveryState::RequestSent, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::WaitingForDecision, DeliveryEvent::Accepted, DeliveryState::Accepted),
            (DeliveryState::WaitingForDecision, DeliveryEvent::Rejected, DeliveryState::Rejected),
            (DeliveryState::WaitingForDecision, DeliveryEvent::Expired, DeliveryState::Failed),
            (DeliveryState::WaitingForDecision, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::Accepted, DeliveryEvent::TransferPrepared, DeliveryState::TransferPreparing),
            (DeliveryState::Accepted, DeliveryEvent::Cancelled, DeliveryState::Cancelled),
            (DeliveryState::Accepted, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::TransferPreparing, DeliveryEvent::TransferStarted, DeliveryState::Transferring),
            (DeliveryState::TransferPreparing, DeliveryEvent::Cancelled, DeliveryState::Cancelled),
            (DeliveryState::TransferPreparing, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::Transferring, DeliveryEvent::VerificationInitiated, DeliveryState::Verifying),
            (DeliveryState::Transferring, DeliveryEvent::Cancelled, DeliveryState::Cancelled),
            (DeliveryState::Transferring, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::Transferring, DeliveryEvent::TransferTimedOut, DeliveryState::Failed),
            (DeliveryState::Verifying, DeliveryEvent::Verified, DeliveryState::Verified),
            (DeliveryState::Verifying, DeliveryEvent::Cancelled, DeliveryState::Cancelled),
            (DeliveryState::Verifying, DeliveryEvent::ConnectionLost, DeliveryState::Failed),
            (DeliveryState::Verifying, DeliveryEvent::IntegrityMismatch, DeliveryState::Failed),
            (DeliveryState::Verified, DeliveryEvent::InstallPrepared, DeliveryState::InstallReady),
            (DeliveryState::Verified, DeliveryEvent::Cancelled, DeliveryState::Cancelled),
            (DeliveryState::InstallReady, DeliveryEvent::HandoffInitiated, DeliveryState::InstallationHandoff),
            (DeliveryState::InstallReady, DeliveryEvent::Cancelled, DeliveryState::Cancelled),
            (DeliveryState::InstallReady, DeliveryEvent::InstallationUnavailable, DeliveryState::Failed),
            (DeliveryState::InstallationHandoff, DeliveryEvent::Completed, DeliveryState::Completed),
            (DeliveryState::InstallationHandoff, DeliveryEvent::InstallationUnavailable, DeliveryState::Failed),
        ]
    }

    #[test]
    fn initial_state_is_discovering() {
        assert_eq!(INITIAL_DELIVERY_STATE, DeliveryState::Discovering);
    }

    #[test]
    fn terminal_states_have_no_outgoing_edges() {
        for state in DELIVERY_TERMINAL_STATES {
            assert!(is_delivery_terminal(state));
            for event in ALL_DELIVERY_EVENTS {
                assert!(matches!(transition(state, event), DeliveryTransition::Rejected { .. }));
            }
        }
    }

    #[test]
    fn every_non_terminal_state_can_progress() {
        for state in ALL_DELIVERY_STATES {
            if is_delivery_terminal(state) {
                continue;
            }
            let any = ALL_DELIVERY_EVENTS
                .iter()
                .any(|&event| matches!(transition(state, event), DeliveryTransition::Accepted(_)));
            assert!(any, "no outgoing edge from {:?}", state);
        }
    }

    #[test]
    fn exhaustive_matrix_matches_expected_table() {
        let expected = expected_table();
        let mut seen = std::collections::HashSet::new();
        for (state, event, _) in &expected {
            assert!(
                seen.insert((*state, *event)),
                "duplicate edge {:?} + {:?}",
                state, event
            );
        }
        for state in ALL_DELIVERY_STATES {
            for event in ALL_DELIVERY_EVENTS {
                match transition(state, event) {
                    DeliveryTransition::Accepted(to) => assert_eq!(
                        Some(&(state, event, to)),
                        expected.iter().find(|(s, e, _)| *s == state && *e == event),
                        "unexpected accepted edge {:?} + {:?}",
                        state, event
                    ),
                    DeliveryTransition::Rejected { .. } => assert!(
                        expected.iter().find(|(s, e, _)| *s == state && *e == event).is_none(),
                        "edge {:?} + {:?} rejected but declared",
                        state, event
                    ),
                }
            }
        }
    }

    #[test]
    fn is_deterministic() {
        for state in ALL_DELIVERY_STATES {
            for event in ALL_DELIVERY_EVENTS {
                assert_eq!(transition(state, event), transition(state, event));
            }
        }
    }

    #[test]
    fn rejected_transition_preserves_state() {
        match transition(DeliveryState::Discovering, DeliveryEvent::Cancelled) {
            DeliveryTransition::Rejected { from, event } => {
                assert_eq!(from, DeliveryState::Discovering);
                assert_eq!(event, DeliveryEvent::Cancelled);
            }
            DeliveryTransition::Accepted(_) => panic!("cancellation not allowed from DISCOVERING"),
        }
    }

    #[test]
    fn happy_path_reaches_completed() {
        let path: [(DeliveryState, DeliveryEvent); 14] = [
            (DeliveryState::Discovering, DeliveryEvent::DeviceFound),
            (DeliveryState::Available, DeliveryEvent::ConnectInitiated),
            (DeliveryState::Connecting, DeliveryEvent::SecureChannelEstablished),
            (DeliveryState::SecureChannel, DeliveryEvent::SessionEstablished),
            (DeliveryState::SessionEstablished, DeliveryEvent::RequestSent),
            (DeliveryState::RequestSent, DeliveryEvent::AwaitingDecision),
            (DeliveryState::WaitingForDecision, DeliveryEvent::Accepted),
            (DeliveryState::Accepted, DeliveryEvent::TransferPrepared),
            (DeliveryState::TransferPreparing, DeliveryEvent::TransferStarted),
            (DeliveryState::Transferring, DeliveryEvent::VerificationInitiated),
            (DeliveryState::Verifying, DeliveryEvent::Verified),
            (DeliveryState::Verified, DeliveryEvent::InstallPrepared),
            (DeliveryState::InstallReady, DeliveryEvent::HandoffInitiated),
            (DeliveryState::InstallationHandoff, DeliveryEvent::Completed),
        ];
        let mut state = INITIAL_DELIVERY_STATE;
        for (from, event) in path {
            assert_eq!(from, state);
            match transition(state, event) {
                DeliveryTransition::Accepted(next) => state = next,
                DeliveryTransition::Rejected { .. } => panic!("valid transition rejected"),
            }
        }
        assert_eq!(state, DeliveryState::Completed);
    }

    #[test]
    fn every_state_is_reachable_from_initial() {
        let mut reachable = std::collections::HashSet::new();
        let mut frontier = vec![INITIAL_DELIVERY_STATE];
        reachable.insert(INITIAL_DELIVERY_STATE);
        while let Some(state) = frontier.pop() {
            for event in ALL_DELIVERY_EVENTS {
                if let DeliveryTransition::Accepted(next) = transition(state, event) {
                    if reachable.insert(next) {
                        frontier.push(next);
                    }
                }
            }
        }
        assert_eq!(reachable.len(), ALL_DELIVERY_STATES.len());
        for state in ALL_DELIVERY_STATES {
            assert!(reachable.contains(&state), "{:?} unreachable", state);
        }
    }
}