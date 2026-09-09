use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PresentationMode {
    #[serde(rename = "GUI")]
    Gui,
    #[serde(rename = "NOTIFICATION")]
    Notification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Decision { Accept, Reject }

// Values only: transition ownership remains with the future application layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DeliveryState {
    Discovering, Available, Connecting, SecureChannel, SessionEstablished,
    RequestSent, WaitingForDecision, Accepted, TransferPreparing, Transferring,
    Verifying, Verified, InstallReady, InstallationHandoff, Completed,
    Rejected, Failed, Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidRequest, UnsupportedProtocol, RequestExpired, UserRejected,
    TransferCancelled, TransferTimeout, ConnectionLost, FileTooLarge,
    InvalidMetadata, IntegrityMismatch, InstallationUnavailable, InternalError,
}
