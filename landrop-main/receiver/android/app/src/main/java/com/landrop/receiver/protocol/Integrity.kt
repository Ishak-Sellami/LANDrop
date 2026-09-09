package com.landrop.receiver.protocol

import java.util.Locale

// Integrity verification — pure SHA-256 digest classification (protocol spec
// §20-§21, project spec §14, architecture §19). This module performs NO
// hashing and NO I/O: digest computation is platform-provided and lives
// outside the protocol layer (JVM MessageDigest for the receiver; Node `crypto`
// for the desktop host seam). Only the representation contract, digest
// validation, and comparison semantics live here, shared by all three mirrors
// so verification behavior cannot diverge.
//
// Mirrors sender/desktop/src/protocol/integrity.ts and the Rust mirror
// sender/desktop/src-tauri/src/protocol/integrity.rs.
object Integrity {
    private val hex64 = Regex("[0-9a-fA-F]{64}")

    /** Same grammar the Phase 02 Sha256 value class enforces at construction. */
    fun isValidSha256(value: String): Boolean = hex64.matches(value)

    // SHA-256 is hex — all six hex letters A-F are ASCII, so ROOT-locale
    // lowercasing is locale-independent for this input. Both inputs must be
    // valid 64-hex digests; otherwise the comparison is false.
    fun hashesMatch(expected: String, actual: String): Boolean =
        isValidSha256(expected) &&
            isValidSha256(actual) &&
            expected.lowercase(Locale.ROOT) == actual.lowercase(Locale.ROOT)

    /** Protocol §21 truth table; protocol spec §21. */
    enum class IntegrityVerdict { VERIFIED, INTEGRITY_MISMATCH }

    fun classifyVerification(expected: String, actual: String): IntegrityVerdict =
        if (hashesMatch(expected, actual)) {
            IntegrityVerdict.VERIFIED
        } else {
            IntegrityVerdict.INTEGRITY_MISMATCH
        }
}