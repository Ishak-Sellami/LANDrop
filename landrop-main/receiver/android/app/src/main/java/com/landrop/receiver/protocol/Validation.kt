package com.landrop.receiver.protocol

class ProtocolProblem(val code: ErrorCode, val field: String) :
    IllegalArgumentException("${code.name}: $field")

// Configurable implementation defaults, not normative specification limits.
// All text lengths are UTF-8 bytes, matching Rust rather than UTF-16 units.
data class Limits(
    val maxJsonBytes: Int = 65536,
    val maxTextBytes: Int = 256,
    val maxDescriptionBytes: Int = 4096,
    val maxApkBytes: Long = 4_294_967_296,
)

internal fun invalid(field: String): Nothing = throw ProtocolProblem(ErrorCode.INVALID_REQUEST, field)
private fun metadata(field: String): Nothing = throw ProtocolProblem(ErrorCode.INVALID_METADATA, field)
internal fun wellFormedUnicode(value: String): Boolean {
    var i = 0
    while (i < value.length) {
        val c = value[i++]
        if (c.isHighSurrogate()) {
            if (i == value.length || !value[i++].isLowSurrogate()) return false
        } else if (c.isLowSurrogate()) return false
    }
    return true
}
private fun text(value: String, max: Int, empty: Boolean, field: String) {
    val blank = value.trim(' ', '\t', '\r', '\n').isEmpty()
    if (!wellFormedUnicode(value) || value.toByteArray(Charsets.UTF_8).size > max ||
        '\u0000' in value || (!empty && blank)) metadata(field)
}
fun ProtocolVersion.validate(limits: Limits = Limits()) {
    if (value <= 0) invalid("protocol_version")
    if (value != CURRENT_PROTOCOL_VERSION) throw ProtocolProblem(ErrorCode.UNSUPPORTED_PROTOCOL, "protocol_version")
}
fun SenderProfile.validate(limits: Limits = Limits()) {
    text(displayName, limits.maxTextBytes, false, "sender.display_name")
}
fun ApplicationMetadata.validate(limits: Limits = Limits()) {
    val packagePattern = Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")
    if (identity.packageName.length > 255 || !packagePattern.matches(identity.packageName)) metadata("application.package_name")
    if (identity.sizeBytes <= 0) metadata("application.size_bytes")
    if (identity.sizeBytes > limits.maxApkBytes) throw ProtocolProblem(ErrorCode.FILE_TOO_LARGE, "application.size_bytes")
    text(presentation.name, limits.maxTextBytes, false, "application.name")
    text(presentation.version, limits.maxTextBytes, false, "application.version")
    text(presentation.description, limits.maxDescriptionBytes, true, "application.description")
}
fun ControlMessage.validate(limits: Limits = Limits()) {
    when (this) {
        is DeliveryRequest -> {
            protocolVersion.validate(limits)
            sender.validate(limits)
            application.validate(limits)
        }
        is DeliveryResponse -> Unit
        is ErrorMessage -> text(message, limits.maxDescriptionBytes, false, "message")
        is TransferProgress -> {
            // transfer_id validity is enforced by the TransferId value class at
            // construction. Byte counters must be non-negative and consistent
            // (bytesTransferred <= totalBytes), matching the TypeScript codec.
            if (bytesTransferred < 0 || totalBytes < 0 || bytesTransferred > totalBytes) {
                invalid("bytes_transferred")
            }
        }
        is TransferCancel -> Unit
    }
}
fun Lifetime.validate(limits: Limits = Limits()) {
    if (createdAtMs < 0 || expiresAtMs <= createdAtMs) invalid("lifetime")
}
fun ApkVersion.validate(limits: Limits = Limits()) {
    if (versionCode != null && versionCode < 0) metadata("version_code")
    versionName?.let { text(it, limits.maxTextBytes, true, "version_name") }
}
fun SessionData.validate(limits: Limits = Limits()) {
    protocolVersion.validate(limits)
    sender.validate(limits)
    text(receiver.deviceName, limits.maxTextBytes, false, "receiver.device_name")
    lifetime.validate(limits)
}
