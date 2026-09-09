use super::{Decision, DeliveryState, ErrorCode, PresentationMode, ProtocolVersion, RequestId, SessionId, Sha256, TransferId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SenderProfile { pub display_name: String }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Presentation { pub mode: PresentationMode }

// Wire claims, not evidence that an APK was inspected or a sender authenticated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApkIdentity {
    pub package_name: String,
    pub size_bytes: i64,
    pub sha256: Sha256,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationPresentation {
    pub name: String,
    pub version: String,
    pub description: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(from = "WireApplication", into = "WireApplication")]
pub struct ApplicationMetadata {
    pub identity: ApkIdentity,
    pub presentation: ApplicationPresentation,
}

// Preserve the flat application object specified in protocol section 11.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WireApplication {
    name: String,
    version: String,
    description: String,
    package_name: String,
    size_bytes: i64,
    sha256: Sha256,
}
impl From<WireApplication> for ApplicationMetadata {
    fn from(value: WireApplication) -> Self {
        Self {
            identity: ApkIdentity { package_name: value.package_name, size_bytes: value.size_bytes, sha256: value.sha256 },
            presentation: ApplicationPresentation { name: value.name, version: value.version, description: value.description },
        }
    }
}
impl From<ApplicationMetadata> for WireApplication {
    fn from(value: ApplicationMetadata) -> Self {
        Self {
            name: value.presentation.name, version: value.presentation.version,
            description: value.presentation.description, package_name: value.identity.package_name,
            size_bytes: value.identity.size_bytes, sha256: value.identity.sha256,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryRequest {
    pub protocol_version: ProtocolVersion,
    pub request_id: RequestId,
    pub session_id: SessionId,
    /// Selected by the Sender, never a Receiver preference.
    pub presentation: Presentation,
    pub sender: SenderProfile,
    pub application: ApplicationMetadata,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeliveryResponse { pub request_id: RequestId, pub decision: Decision }
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorMessage { pub request_id: RequestId, pub code: ErrorCode, pub message: String }

// Transfer observation and cancellation frames (protocol spec §19, §24).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferProgress {
    pub transfer_id: TransferId,
    pub bytes_transferred: i64,
    pub total_bytes: i64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransferCancel { pub transfer_id: TransferId }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ControlMessage {
    #[serde(rename = "delivery_request")]
    DeliveryRequest(DeliveryRequest),
    #[serde(rename = "delivery_response")]
    DeliveryResponse(DeliveryResponse),
    #[serde(rename = "error")]
    Error(ErrorMessage),
    #[serde(rename = "transfer_progress")]
    TransferProgress(TransferProgress),
    #[serde(rename = "transfer_cancel")]
    TransferCancel(TransferCancel),
}

// Local supporting data, deliberately not wire-serializable: the specification
// does not define timestamp units/fields, icon encoding, or APK version fields
// on the wire. Do not silently extend the Delivery Request schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApkVersion { pub version_code: Option<i64>, pub version_name: Option<String> }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo { pub device_name: String }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Lifetime { pub created_at_ms: i64, pub expires_at_ms: i64 }
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionData {
    pub session_id: SessionId,
    pub protocol_version: ProtocolVersion,
    pub sender: SenderProfile,
    pub receiver: DeviceInfo,
    pub state: DeliveryState,
    pub lifetime: Lifetime,
}
