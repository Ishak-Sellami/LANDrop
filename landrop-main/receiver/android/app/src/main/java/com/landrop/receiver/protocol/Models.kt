package com.landrop.receiver.protocol

data class SenderProfile(val displayName: String)

// This is the Sender's request attribute, not a Receiver preference.
data class Presentation(val mode: PresentationMode)

// Wire claims, not proof of APK inspection or sender authenticity.
data class ApkIdentity(val packageName: String, val sizeBytes: Long, val sha256: Sha256)
data class ApplicationPresentation(val name: String, val version: String, val description: String)
data class ApplicationMetadata(val identity: ApkIdentity, val presentation: ApplicationPresentation)

sealed interface ControlMessage

data class DeliveryRequest(
    val protocolVersion: ProtocolVersion,
    val requestId: RequestId,
    val sessionId: SessionId,
    val presentation: Presentation,
    val sender: SenderProfile,
    val application: ApplicationMetadata,
) : ControlMessage

data class DeliveryResponse(val requestId: RequestId, val decision: Decision) : ControlMessage

data class ErrorMessage(
    val requestId: RequestId,
    val code: ErrorCode,
    val message: String,
) : ControlMessage

// Transfer observation and cancellation frames (protocol spec §19, §24).
data class TransferProgress(
    val transferId: TransferId,
    val bytesTransferred: Long,
    val totalBytes: Long,
) : ControlMessage

data class TransferCancel(val transferId: TransferId) : ControlMessage

// Supporting local data only. The specification does not define wire fields
// for APK versions, timestamp units, or icon encoding. No silent v1 extensions.
data class ApkVersion(val versionCode: Long?, val versionName: String?)
data class DeviceInfo(val deviceName: String)
data class Lifetime(val createdAtMs: Long, val expiresAtMs: Long)
data class SessionData(
    val sessionId: SessionId,
    val protocolVersion: ProtocolVersion,
    val sender: SenderProfile,
    val receiver: DeviceInfo,
    val state: DeliveryState,
    val lifetime: Lifetime,
)
