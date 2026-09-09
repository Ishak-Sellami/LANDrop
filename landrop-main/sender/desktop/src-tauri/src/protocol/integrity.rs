//! Integrity verification — pure SHA-256 digest classification (protocol spec
//! §20-§21, project spec §14, architecture §19). This module performs NO
//! hashing and NO I/O: digest computation is platform-provided and lives
//! outside the protocol layer. Only the representation contract, digest
//! validation, and comparison semantics live here, shared by all three mirrors
//! so verification behavior cannot diverge.
//!
//! Digest computation notes:
//! - TypeScript host seam: sender/desktop/src/application/sha256Hash.ts
//!   (Node `crypto`), executable reference.
//! - Kotlin receiver: receiver/android/.../platform/Sha256Stream.kt
//!   (JVM MessageDigest).
//! - Rust: deferred. Sender-side APK hashing is application-layer work that
//!   would require the RustCrypto `sha2` crate. Per repository policy (no
//!   unnecessary dependencies), that dependency is NOT added in Phase 07; the
//!   sender digest is produced by the platform seam when the app layer lands.
//!
//! Mirrors sender/desktop/src/protocol/integrity.ts and the Kotlin mirror
//! receiver/android/.../protocol/Integrity.kt.

/// A SHA-256 digest is exactly 64 hex characters ([0-9a-fA-F]).
pub const SHA256_HEX_LENGTH: usize = 64;

/// Same grammar the Phase 02 `Sha256` newtype enforces at construction.
pub fn is_valid_sha256(value: &str) -> bool {
    value.len() == SHA256_HEX_LENGTH && value.bytes().all(|b| b.is_ascii_hexdigit())
}

/// Case-insensitive digest equality (protocol §21). Hex letters A-F are ASCII,
/// so ASCII case-folding is locale-independent for this input. Both inputs
/// must be valid 64-hex digests; otherwise the comparison is false.
pub fn hashes_match(expected: &str, actual: &str) -> bool {
    is_valid_sha256(expected)
        && is_valid_sha256(actual)
        && expected.to_ascii_lowercase() == actual.to_ascii_lowercase()
}

/// Protocol §21 truth table: equal digests -> Verified, anything else ->
/// IntegrityMismatch. The engine validates inputs before calling this, so the
/// invalid-input fallback (mismatch) is only a defensive classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IntegrityVerdict {
    Verified,
    IntegrityMismatch,
}

pub fn classify_verification(expected: &str, actual: &str) -> IntegrityVerdict {
    if hashes_match(expected, actual) {
        IntegrityVerdict::Verified
    } else {
        IntegrityVerdict::IntegrityMismatch
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ABC: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn known_vectors_are_valid_lowercase_digests() {
        assert!(is_valid_sha256(ABC));
        assert!(is_valid_sha256(EMPTY));
    }

    #[test]
    fn rejects_malformed_digests() {
        assert!(!is_valid_sha256("abc"));
        assert!(!is_valid_sha256(""));
        assert!(!is_valid_sha256(&"a".repeat(63)));
        assert!(!is_valid_sha256(&"a".repeat(65)));
        assert!(!is_valid_sha256(&"g".repeat(64)));
    }

    #[test]
    fn comparison_is_case_insensitive_and_validated() {
        assert!(hashes_match(ABC, ABC));
        assert!(hashes_match(&ABC.to_uppercase(), ABC));
        assert!(hashes_match(ABC, &ABC.to_uppercase()));
        assert!(!hashes_match(ABC, EMPTY));
        assert!(!hashes_match("not-a-digest", ABC));
        assert!(!hashes_match(ABC, ""));
    }

    #[test]
    fn classification_follows_protocol_truth_table() {
        assert_eq!(classify_verification(ABC, ABC), IntegrityVerdict::Verified);
        assert_eq!(
            classify_verification(&ABC.to_uppercase(), ABC),
            IntegrityVerdict::Verified
        );
        assert_eq!(
            classify_verification(ABC, EMPTY),
            IntegrityVerdict::IntegrityMismatch
        );
    }
}