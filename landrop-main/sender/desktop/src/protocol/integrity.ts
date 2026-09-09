// Integrity verification — pure SHA-256 digest classification (protocol spec
// §20-§21, project spec §14, architecture §19). This module performs NO
// hashing and NO I/O: digest computation is platform-provided and lives
// outside the protocol layer (Node `crypto` for the desktop host seam, JVM
// MessageDigest for the Android receiver). Only the representation contract,
// digest validation, and comparison semantics live here, shared by all three
// mirrors so verification behavior cannot diverge.
//
// Mirrors sender/desktop/src-tauri/src/protocol/integrity.rs and
// receiver/android/.../protocol/Integrity.kt.

import { HEX64_RE } from "./codec";

// 64 hex characters ([0-9a-fA-F]); the same grammar the Phase 02 codec already
// enforces for `application.sha256`.
export function isValidSha256(value: string): boolean {
  return HEX64_RE.test(value);
}

// Case-insensitive digest equality (protocol §21: the receiver compares the
// digest it computes against the digest the Sender declared, and decides
// VERIFIED or INTEGRITY_MISMATCH). SHA-256 is hex — all six hex letters A-F
// are ASCII, so `toLowerCase` is locale-independent for this input.
// Both inputs must be valid 64-hex digests; otherwise the comparison is false.
export function hashesMatch(expected: string, actual: string): boolean {
  return (
    isValidSha256(expected) &&
    isValidSha256(actual) &&
    expected.toLowerCase() === actual.toLowerCase()
  );
}

export type IntegrityVerdict = "VERIFIED" | "INTEGRITY_MISMATCH";

// Protocol §21 truth table: equal digests -> VERIFIED, anything else ->
// INTEGRITY_MISMATCH. The engine validates inputs before calling this, so the
// invalid-input fallback (mismatch) is only a defensive classification.
export function classifyVerification(
  expected: string,
  actual: string,
): IntegrityVerdict {
  return hashesMatch(expected, actual) ? "VERIFIED" : "INTEGRITY_MISMATCH";
}