package com.landrop.receiver.protocol

const val CURRENT_PROTOCOL_VERSION = 1

data class ProtocolVersion(val value: Int)

// Opaque ASCII IDs, not paths. Example prefixes do not mandate UUIDs/ULIDs.
private val idPattern = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")
private fun requireId(value: String) {
    require(idPattern.matches(value)) { "Invalid protocol identifier" }
}

@JvmInline
value class SessionId(val value: String) { init { requireId(value) } }
@JvmInline
value class RequestId(val value: String) { init { requireId(value) } }
@JvmInline
value class TransferId(val value: String) { init { requireId(value) } }

// Integrity representation only. No hashing or identity authentication.
@JvmInline
value class Sha256(val value: String) {
    init { require(Regex("[0-9a-fA-F]{64}").matches(value)) { "Invalid sha256" } }
}
