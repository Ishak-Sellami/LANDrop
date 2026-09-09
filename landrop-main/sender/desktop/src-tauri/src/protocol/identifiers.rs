use serde::{Deserialize, Serialize};

pub const CURRENT_PROTOCOL_VERSION: i32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProtocolVersion(pub i32);

// Opaque identifiers, not paths or mandated UUID/ULID encodings. Prefixes in
// the specification are examples. Both implementations use this ASCII grammar.
fn valid_id(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

macro_rules! string_type {
    ($name:ident, $valid:expr, $error:literal) => {
        #[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);
        impl $name {
            pub fn new(value: impl Into<String>) -> Result<Self, &'static str> {
                let value = value.into();
                if ($valid)(&value) { Ok(Self(value)) } else { Err($error) }
            }
            pub fn as_str(&self) -> &str { &self.0 }
        }
        impl TryFrom<String> for $name {
            type Error = &'static str;
            fn try_from(value: String) -> Result<Self, Self::Error> { Self::new(value) }
        }
        impl From<$name> for String {
            fn from(value: $name) -> Self { value.0 }
        }
    };
}

string_type!(SessionId, valid_id, "invalid session_id");
string_type!(RequestId, valid_id, "invalid request_id");
string_type!(TransferId, valid_id, "invalid transfer_id");
string_type!(Sha256, |v: &str| v.len() == 64 && v.bytes().all(|c| c.is_ascii_hexdigit()), "invalid sha256");
