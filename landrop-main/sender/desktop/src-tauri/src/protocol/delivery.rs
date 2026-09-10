//! Delivery Engine — deterministic delivery-request, transfer-flow, integrity-
//! verification, and installation-handoff orchestration (protocol spec §8-§26,
//! project spec §12-§19, architecture §18, §21). Pure decision logic only:
//! validates input, checks the frozen Phase 03 Delivery State Machine, computes
//! the event + next state, and emits a side-effect instruction. No I/O, no
//! storage, no hashing, and no installation work (protocol §20-§23 gate
//! VERIFYING -> INSTALLATION_HANDOFF; the digest is computed by the platform
//! seam and handed in, and the installer is invoked by the application layer).
//!
//! Mirrors sender/desktop/src/protocol/delivery.ts and the Kotlin mirror
//! receiver/android/.../protocol/Delivery.kt.

use super::{
    hashes_match, is_delivery_terminal, is_valid_sha256, transition, ControlMessage, Decision,
    DeliveryEvent, DeliveryRequest, DeliveryResponse, DeliveryState, DeliveryTransition,
    RequestId, SessionId, TransferId,
};

// Local decision-layer diagnostics, never wire ErrorCodes (same guarantee as
// the TypeScript mirror: no new wire error codes are invented).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeliveryProblem {
    InvalidState,
    InvalidTransition,
    NoRequest,
    NoTransfer,
    RequestMismatch,
    ResponseMismatch,
    TransferIdMismatch,
    InvalidTransferId,
    InvalidBytes,
    SizeExceeded,
    SizeMismatch,
    SizeValidationFailed,
    InvalidDigest,
    NoDigest,
    IntegrityMismatch,
}

// Side-effect instruction executed by the application layer; this module never
// performs I/O.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DeliveryAction {
    None,
    SendMessage(ControlMessage),
    BeginStream,
    StopStream,
    InvokeInstaller,
    Cleanup,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeliveryOutcome {
    pub ok: bool,
    pub event: Option<DeliveryEvent>,
    pub to: Option<DeliveryState>,
    pub action: DeliveryAction,
    pub problem: Option<DeliveryProblem>,
}

pub fn outcome_problem(problem: DeliveryProblem) -> DeliveryOutcome {
    DeliveryOutcome {
        ok: false,
        event: None,
        to: None,
        action: DeliveryAction::None,
        problem: Some(problem),
    }
}

pub fn decision_event(decision: Decision) -> DeliveryEvent {
    match decision {
        Decision::Accept => DeliveryEvent::Accepted,
        Decision::Reject => DeliveryEvent::Rejected,
    }
}

pub fn create_delivery_response(request_id: &RequestId, decision: Decision) -> DeliveryResponse {
    DeliveryResponse {
        request_id: request_id.clone(),
        decision,
    }
}

/// Clamped percentage (0..=100). Progress is observation, not a Delivery State
/// (protocol spec §31): the machine stays in Transferring.
pub fn calculate_transfer_progress(bytes_transferred: i64, total_bytes: i64) -> i64 {
    if total_bytes <= 0 {
        return 0;
    }
    (bytes_transferred.max(0) * 100 / total_bytes).clamp(0, 100)
}

// Defense-in-depth parity with the TypeScript engine, which validates the raw
// string at beginTransfer. The TransferId newtype already enforces this grammar
// at construction, so this is always true for values that reach the engine.
fn transfer_id_ok(id: &TransferId) -> bool {
    let value = id.as_str();
    (1..=128).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

pub struct DeliveryEngine {
    session_id: SessionId,
    state: DeliveryState,
    request: Option<DeliveryRequest>,
    transfer_id: Option<TransferId>,
    bytes_transferred: i64,
}

impl DeliveryEngine {
    pub fn new(session_id: SessionId) -> Self {
        Self::with_state(session_id, DeliveryState::SessionEstablished)
    }

    pub fn with_state(session_id: SessionId, state: DeliveryState) -> Self {
        Self {
            session_id,
            state,
            request: None,
            transfer_id: None,
            bytes_transferred: 0,
        }
    }

    pub fn state(&self) -> DeliveryState {
        self.state
    }

    pub fn request(&self) -> Option<&DeliveryRequest> {
        self.request.as_ref()
    }

    pub fn transfer_id(&self) -> Option<&TransferId> {
        self.transfer_id.as_ref()
    }

    pub fn declared_size(&self) -> i64 {
        self.request
            .as_ref()
            .map(|r| r.application.identity.size_bytes)
            .unwrap_or(0)
    }

    /// Expected digest the Sender declared in the delivery request (project
    /// spec §14). The receiver verifies its independently computed digest
    /// against it.
    pub fn expected_digest(&self) -> Option<&str> {
        self.request
            .as_ref()
            .map(|r| r.application.identity.sha256.as_str())
    }

    pub fn bytes_transferred(&self) -> i64 {
        self.bytes_transferred
    }

    pub fn progress_percent(&self) -> i64 {
        calculate_transfer_progress(self.bytes_transferred, self.declared_size())
    }

    fn require_no_terminal(&self) -> Option<DeliveryProblem> {
        if is_delivery_terminal(self.state) {
            Some(DeliveryProblem::InvalidState)
        } else {
            None
        }
    }

    fn apply(&mut self, event: DeliveryEvent, requested_state: DeliveryState) -> DeliveryOutcome {
        if self.state != requested_state {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        match transition(self.state, event) {
            DeliveryTransition::Accepted(to) => {
                self.state = to;
                DeliveryOutcome {
                    ok: true,
                    event: Some(event),
                    to: Some(to),
                    action: DeliveryAction::None,
                    problem: None,
                }
            }
            DeliveryTransition::Rejected { .. } => outcome_problem(DeliveryProblem::InvalidTransition),
        }
    }

    fn finish(inner: DeliveryOutcome, action: DeliveryAction) -> DeliveryOutcome {
        DeliveryOutcome { action, ..inner }
    }

    /// Sender: register and send a delivery request (spec §8-§13).
    pub fn register_delivery_request(&mut self, request: DeliveryRequest) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::SessionEstablished {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        if request.session_id != self.session_id {
            return outcome_problem(DeliveryProblem::RequestMismatch);
        }
        self.request = Some(request.clone());
        self.bytes_transferred = 0;
        let applied = self.apply(DeliveryEvent::RequestSent, DeliveryState::SessionEstablished);
        Self::finish(
            applied,
            DeliveryAction::SendMessage(ControlMessage::DeliveryRequest(request)),
        )
    }

    /// Sender: request is on the wire; wait for the Receiver decision.
    pub fn await_decision(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        self.apply(DeliveryEvent::AwaitingDecision, DeliveryState::RequestSent)
    }

    /// Receiver: validate an incoming delivery request (spec §35-§37).
    pub fn receive_incoming_request(&mut self, request: DeliveryRequest) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::SessionEstablished {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        if request.session_id != self.session_id {
            return outcome_problem(DeliveryProblem::RequestMismatch);
        }
        self.request = Some(request);
        self.bytes_transferred = 0;
        // Mirror of the Sender's machine advance: request present -> awaiting user.
        let applied = self.apply(DeliveryEvent::RequestSent, DeliveryState::SessionEstablished);
        Self::finish(applied, DeliveryAction::None)
    }

    /// Receiver: send the decision (spec §10, §14-§15).
    pub fn send_decision(&mut self, decision: Decision) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::WaitingForDecision {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let Some(request) = &self.request else {
            return outcome_problem(DeliveryProblem::NoRequest);
        };
        let request_id = request.request_id.clone();
        let applied = self.apply(decision_event(decision), DeliveryState::WaitingForDecision);
        // Spec §14-§15: the Receiver sends delivery_response for BOTH decisions.
        Self::finish(
            applied,
            DeliveryAction::SendMessage(ControlMessage::DeliveryResponse(
                create_delivery_response(&request_id, decision),
            )),
        )
    }

    /// Sender: process the Receiver's response.
    pub fn process_response(&mut self, response: DeliveryResponse) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::WaitingForDecision {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let Some(request) = &self.request else {
            return outcome_problem(DeliveryProblem::NoRequest);
        };
        if response.request_id != request.request_id {
            return outcome_problem(DeliveryProblem::ResponseMismatch);
        }
        self.apply(decision_event(response.decision), DeliveryState::WaitingForDecision)
    }

    /// Expiration (spec §25; the numeric timeout is a recorded gap).
    pub fn expire(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        // A rejected application must not emit a stale cleanup instruction.
        let applied = self.apply(DeliveryEvent::Expired, DeliveryState::WaitingForDecision);
        if !applied.ok {
            return applied;
        }
        Self::finish(applied, DeliveryAction::Cleanup)
    }

    /// Transfer preparation (spec §16).
    pub fn prepare_transfer(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::Accepted {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let applied = self.apply(DeliveryEvent::TransferPrepared, DeliveryState::Accepted);
        Self::finish(applied, DeliveryAction::None)
    }

    /// Transfer start (spec §16-§17).
    pub fn begin_transfer(&mut self, transfer_id: TransferId) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::TransferPreparing {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        if self.request.is_none() {
            return outcome_problem(DeliveryProblem::NoRequest);
        }
        if !transfer_id_ok(&transfer_id) {
            return outcome_problem(DeliveryProblem::InvalidTransferId);
        }
        let declared = self.declared_size();
        if declared <= 0 {
            return outcome_problem(DeliveryProblem::SizeValidationFailed);
        }
        self.transfer_id = Some(transfer_id);
        self.bytes_transferred = 0;
        let applied = self.apply(DeliveryEvent::TransferStarted, DeliveryState::TransferPreparing);
        Self::finish(applied, DeliveryAction::BeginStream)
    }

    /// Byte accounting (spec §18 receiver-side size enforcement).
    pub fn record_bytes(&mut self, count: i64) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::Transferring {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        if count <= 0 {
            return outcome_problem(DeliveryProblem::InvalidBytes);
        }
        let next = self.bytes_transferred.saturating_add(count);
        if next > self.declared_size() {
            return outcome_problem(DeliveryProblem::SizeExceeded);
        }
        self.bytes_transferred = next;
        DeliveryOutcome {
            ok: true,
            event: None,
            to: None,
            action: DeliveryAction::None,
            problem: None,
        }
    }

    /// Transfer completion (spec §19-§20): stops at VerificationInitiated.
    pub fn complete_transfer(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::Transferring {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        if self.transfer_id.is_none() {
            return outcome_problem(DeliveryProblem::NoTransfer);
        }
        if self.bytes_transferred != self.declared_size() {
            return outcome_problem(DeliveryProblem::SizeMismatch);
        }
        let applied = self.apply(DeliveryEvent::VerificationInitiated, DeliveryState::Transferring);
        Self::finish(applied, DeliveryAction::None)
    }

    /// Receiver: integrity verification (spec §20-§21). The application layer
    /// computes SHA-256 over the received artifact via the platform seam and
    /// hands the lowercase-hex digest in. The engine classifies it against the
    /// declared digest and routes through the frozen machine.
    pub fn complete_verification(&mut self, actual_digest: &str) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::Verifying {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let Some(request) = &self.request else {
            return outcome_problem(DeliveryProblem::NoRequest);
        };
        let expected = &request.application.identity.sha256;
        // Unreachable in practice: the Sha256 newtype guarantees 64 hex chars,
        // so an empty/absent declared digest cannot exist. Kept for defensive
        // parity with the TS and Kotlin mirrors, whose boundaries accept the
        // raw string.
        if expected.as_str().is_empty() {
            return outcome_problem(DeliveryProblem::NoDigest);
        }
        if !is_valid_sha256(actual_digest) {
            return outcome_problem(DeliveryProblem::InvalidDigest);
        }
        if hashes_match(expected.as_str(), actual_digest) {
            let applied = self.apply(DeliveryEvent::Verified, DeliveryState::Verifying);
            Self::finish(applied, DeliveryAction::None)
        } else {
            // Protocol §21: mismatch -> FAILED, installation blocked, cleanup.
            let applied = self.apply(DeliveryEvent::IntegrityMismatch, DeliveryState::Verifying);
            let outcome = Self::finish(applied, DeliveryAction::Cleanup);
            DeliveryOutcome {
                problem: Some(DeliveryProblem::IntegrityMismatch),
                ..outcome
            }
        }
    }

    /// Receiver: installation handoff (spec §23, project spec §26).
    pub fn prepare_install(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::Verified {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let applied = self.apply(DeliveryEvent::InstallPrepared, DeliveryState::Verified);
        Self::finish(applied, DeliveryAction::None)
    }

    /// The application layer calls this immediately before invoking the
    /// platform installer; the emitted instruction tells it exactly that.
    pub fn handoff_install(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::InstallReady {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let applied = self.apply(DeliveryEvent::HandoffInitiated, DeliveryState::InstallReady);
        Self::finish(applied, DeliveryAction::InvokeInstaller)
    }

    /// Called only when the platform's supported package-install mechanism has
    /// genuinely reported completion. Nothing fabricates this result.
    pub fn installation_completed(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::InstallationHandoff {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        // Terminal state -> cleanup instruction (artifact/session lifecycle).
        let applied = self.apply(DeliveryEvent::Completed, DeliveryState::InstallationHandoff);
        Self::finish(applied, DeliveryAction::Cleanup)
    }

    /// Platform reports the package installer is unavailable, before or during
    /// handoff (project spec §24 INSTALLATION_UNAVAILABLE).
    pub fn installation_unavailable(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::InstallReady
            && self.state != DeliveryState::InstallationHandoff
        {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let applied = self.apply(DeliveryEvent::InstallationUnavailable, self.state);
        if !applied.ok {
            return applied;
        }
        Self::finish(applied, DeliveryAction::Cleanup)
    }

    /// Cancellation (spec §24; machine-gated).
    pub fn cancel(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        let applied = self.apply(DeliveryEvent::Cancelled, self.state);
        if !applied.ok {
            return applied;
        }
        Self::finish(applied, DeliveryAction::Cleanup)
    }

    /// Incoming transfer_cancel from the Sender (spec §24).
    pub fn process_transfer_cancel(&mut self, transfer_id: TransferId) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        let Some(active) = &self.transfer_id else {
            return outcome_problem(DeliveryProblem::NoTransfer);
        };
        if *active != transfer_id {
            return outcome_problem(DeliveryProblem::TransferIdMismatch);
        }
        let applied = self.apply(DeliveryEvent::Cancelled, self.state);
        if !applied.ok {
            return applied;
        }
        Self::finish(applied, DeliveryAction::StopStream)
    }

    /// Transfer inactivity timeout (spec §26).
    pub fn transfer_timeout(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        if self.state != DeliveryState::Transferring {
            return outcome_problem(DeliveryProblem::InvalidState);
        }
        let applied = self.apply(DeliveryEvent::TransferTimedOut, DeliveryState::Transferring);
        if !applied.ok {
            return applied;
        }
        Self::finish(applied, DeliveryAction::Cleanup)
    }

    /// Connection loss at any pre-terminal stage (spec §27).
    pub fn connection_lost(&mut self) -> DeliveryOutcome {
        if let Some(terminal) = self.require_no_terminal() {
            return outcome_problem(terminal);
        }
        let applied = self.apply(DeliveryEvent::ConnectionLost, self.state);
        if !applied.ok {
            return applied;
        }
        Self::finish(applied, DeliveryAction::Cleanup)
    }
}