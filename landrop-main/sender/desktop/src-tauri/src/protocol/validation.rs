use super::{ApkVersion, ApplicationMetadata, ControlMessage, DeliveryRequest, ErrorCode, Lifetime, ProtocolVersion, SenderProfile, SessionData, TransferProgress, CURRENT_PROTOCOL_VERSION};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProtocolProblem { pub code: ErrorCode, pub field: &'static str }
impl ProtocolProblem {
    pub(crate) fn invalid(field: &'static str) -> Self { Self { code: ErrorCode::InvalidRequest, field } }
}
impl fmt::Display for ProtocolProblem {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { write!(f, "{:?}: {}", self.code, self.field) }
}
impl std::error::Error for ProtocolProblem {}

// Configurable implementation defaults, not normative specification limits.
// Lengths are UTF-8 bytes, identically measured on Android.
#[derive(Debug, Clone)]
pub struct Limits {
    pub max_json_bytes: usize,
    pub max_text_bytes: usize,
    pub max_description_bytes: usize,
    pub max_apk_bytes: i64,
}
impl Default for Limits {
    fn default() -> Self {
        Self { max_json_bytes: 65536, max_text_bytes: 256, max_description_bytes: 4096, max_apk_bytes: 4_294_967_296 }
    }
}
pub trait Validate { fn validate(&self, limits: &Limits) -> Result<(), ProtocolProblem>; }
fn metadata(field: &'static str) -> ProtocolProblem { ProtocolProblem { code: ErrorCode::InvalidMetadata, field } }
fn text(value: &str, max: usize, empty: bool, field: &'static str) -> Result<(), ProtocolProblem> {
    let blank = value.trim_matches([' ', '\t', '\r', '\n']).is_empty();
    if value.len() > max || value.contains('\0') || (!empty && blank) { Err(metadata(field)) } else { Ok(()) }
}
impl Validate for ProtocolVersion {
    fn validate(&self, _: &Limits) -> Result<(), ProtocolProblem> {
        if self.0 <= 0 { Err(ProtocolProblem::invalid("protocol_version")) }
        else if self.0 != CURRENT_PROTOCOL_VERSION { Err(ProtocolProblem { code: ErrorCode::UnsupportedProtocol, field: "protocol_version" }) }
        else { Ok(()) }
    }
}
impl Validate for SenderProfile {
    fn validate(&self, l: &Limits) -> Result<(), ProtocolProblem> { text(&self.display_name, l.max_text_bytes, false, "sender.display_name") }
}
impl Validate for ApplicationMetadata {
    fn validate(&self, l: &Limits) -> Result<(), ProtocolProblem> {
        let package = &self.identity.package_name;
        let segments: Vec<_> = package.split('.').collect();
        let valid = package.len() <= 255 && segments.len() >= 2 && segments.iter().all(|s| {
            !s.is_empty() && s.as_bytes()[0].is_ascii_alphabetic()
                && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_')
        });
        if !valid { return Err(metadata("application.package_name")); }
        if self.identity.size_bytes <= 0 { return Err(metadata("application.size_bytes")); }
        if self.identity.size_bytes > l.max_apk_bytes {
            return Err(ProtocolProblem { code: ErrorCode::FileTooLarge, field: "application.size_bytes" });
        }
        text(&self.presentation.name, l.max_text_bytes, false, "application.name")?;
        text(&self.presentation.version, l.max_text_bytes, false, "application.version")?;
        text(&self.presentation.description, l.max_description_bytes, true, "application.description")
    }
}
impl Validate for DeliveryRequest {
    fn validate(&self, l: &Limits) -> Result<(), ProtocolProblem> {
        self.protocol_version.validate(l)?;
        self.sender.validate(l)?;
        self.application.validate(l)
    }
}
impl Validate for ControlMessage {
    fn validate(&self, l: &Limits) -> Result<(), ProtocolProblem> {
        match self {
            Self::DeliveryRequest(v) => v.validate(l),
            Self::DeliveryResponse(_) => Ok(()),
            Self::Error(v) => text(&v.message, l.max_description_bytes, false, "message"),
            Self::TransferProgress(v) => v.validate(l),
            Self::TransferCancel(_) => Ok(()),
        }
    }
}
impl Validate for TransferProgress {
    fn validate(&self, _: &Limits) -> Result<(), ProtocolProblem> {
        // transfer_id validity is enforced by the TransferId newtype at
        // construction. Byte counters must be non-negative and consistent
        // (bytes_transferred <= total_bytes), matching the TypeScript codec.
        if self.bytes_transferred < 0 || self.total_bytes < 0 {
            return Err(ProtocolProblem::invalid("bytes_transferred"));
        }
        if self.bytes_transferred > self.total_bytes {
            return Err(ProtocolProblem::invalid("bytes_transferred"));
        }
        Ok(())
    }
}
impl Validate for Lifetime {
    fn validate(&self, _: &Limits) -> Result<(), ProtocolProblem> {
        if self.created_at_ms < 0 || self.expires_at_ms <= self.created_at_ms { Err(ProtocolProblem::invalid("lifetime")) } else { Ok(()) }
    }
}
impl Validate for ApkVersion {
    fn validate(&self, l: &Limits) -> Result<(), ProtocolProblem> {
        if self.version_code.is_some_and(|v| v < 0) { return Err(metadata("version_code")); }
        if let Some(v) = &self.version_name { text(v, l.max_text_bytes, true, "version_name")?; }
        Ok(())
    }
}
impl Validate for SessionData {
    fn validate(&self, l: &Limits) -> Result<(), ProtocolProblem> {
        self.protocol_version.validate(l)?;
        self.sender.validate(l)?;
        text(&self.receiver.device_name, l.max_text_bytes, false, "receiver.device_name")?;
        self.lifetime.validate(l)
    }
}
