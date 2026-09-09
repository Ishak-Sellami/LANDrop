package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class ValidationTest {
    private fun validRequest() = DeliveryRequest(
        ProtocolVersion(1),
        RequestId("req_01JTEST"),
        SessionId("sess_01JTEST"),
        Presentation(PresentationMode.GUI),
        SenderProfile("ISHAQ CYBERTECH"),
        ApplicationMetadata(
            ApkIdentity(
                "com.example.application",
                26_004_608,
                Sha256("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
            ),
            ApplicationPresentation("My Application", "1.4.2", "A local test application."),
        ),
    )

    @Test
    fun acceptsValidDeliveryRequest() {
        validRequest().validate(Limits())
    }

    @Test
    fun acceptsValidMetadataFields() {
        val metadata =
            ApplicationMetadata(
                ApkIdentity(
                    "com.example.application",
                    1,
                    Sha256("1111111111111111111111111111111111111111111111111111111111111111"),
                ),
                ApplicationPresentation("a", "1", "optional"),
            )
        metadata.validate(Limits())
    }

    @Test
    fun rejectsVersionZero() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest().copy(protocolVersion = ProtocolVersion(0)).validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_REQUEST, problem.code)
    }

    @Test
    fun rejectsUnsupportedVersion() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest().copy(protocolVersion = ProtocolVersion(2)).validate(Limits())
        }
        assertEquals(ErrorCode.UNSUPPORTED_PROTOCOL, problem.code)
    }

    @Test
    fun rejectsBlankSenderName() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest().copy(sender = SenderProfile("   ")).validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_METADATA, problem.code)
    }

    @Test
    fun rejectsPackageNameWithoutDot() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest()
                .copy(
                    application = validRequest().application.copy(
                        identity = validRequest().application.identity.copy(packageName = "nocomponent"),
                    ),
                )
                .validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_METADATA, problem.code)
    }

    @Test
    fun rejectsZeroSize() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest()
                .copy(
                    application = validRequest().application.copy(
                        identity = validRequest().application.identity.copy(sizeBytes = 0),
                    ),
                )
                .validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_METADATA, problem.code)
    }

    @Test
    fun rejectsOversizedApk() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest()
                .copy(
                    application = validRequest().application.copy(
                        identity = validRequest().application.identity.copy(sizeBytes = 4_294_967_297),
                    ),
                )
                .validate(Limits())
        }
        assertEquals(ErrorCode.FILE_TOO_LARGE, problem.code)
    }

    @Test
    fun rejectsEmptyApplicationName() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            validRequest()
                .copy(
                    application = validRequest().application.copy(
                        presentation = validRequest().application.presentation.copy(name = ""),
                    ),
                )
                .validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_METADATA, problem.code)
    }

    @Test
    fun acceptsValidDeliveryResponse() {
        DeliveryResponse(RequestId("req_01JTEST"), Decision.REJECT).validate(Limits())
    }

    @Test
    fun rejectsBlankErrorMessage() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            ErrorMessage(RequestId("req_01JTEST"), ErrorCode.INTERNAL_ERROR, "  ").validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_METADATA, problem.code)
    }

    @Test
    fun rejectsEqualLifetimeTimestamps() {
        val problem = assertThrows(ProtocolProblem::class.java) {
            Lifetime(createdAtMs = 1000, expiresAtMs = 1000).validate(Limits())
        }
        assertEquals(ErrorCode.INVALID_REQUEST, problem.code)
    }

    @Test
    fun rejectsLifetimeExpiryBeforeCreation() {
        assertThrows(ProtocolProblem::class.java) {
            Lifetime(createdAtMs = 2000, expiresAtMs = 1000).validate(Limits())
        }
    }

    @Test
    fun acceptsValidSessionData() {
        SessionData(
            sessionId = SessionId("sess_01JTEST"),
            protocolVersion = ProtocolVersion(1),
            sender = SenderProfile("Test"),
            receiver = DeviceInfo("Android Device"),
            state = DeliveryState.DISCOVERING,
            lifetime = Lifetime(createdAtMs = 1000, expiresAtMs = 2000),
        ).validate(Limits())
    }

    @Test
    fun rejectsNegativeApkVersionCode() {
        assertThrows(ProtocolProblem::class.java) {
            ApkVersion(versionCode = -1, versionName = null).validate(Limits())
        }
    }

    @Test
    fun rejectsInvalidSha256() {
        assertThrows(IllegalArgumentException::class.java) { Sha256("abc123") }
    }

    @Test
    fun acceptsValidSha256() {
        Sha256("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")
    }
}