package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolJsonTest {
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
    fun encodesDeliveryRequestAsValidJson() {
        val json = ProtocolJson.encode(validRequest(), Limits()).getOrThrow()
        assertTrue(json.contains("\"type\":\"delivery_request\""))
        assertTrue(json.contains("\"protocol_version\":1"))
        assertTrue(json.contains("\"request_id\":\"req_01JTEST\""))
        assertTrue(json.contains("\"mode\":\"GUI\""))
        assertTrue(json.contains("\"display_name\":\"ISHAQ CYBERTECH\""))
        assertTrue(json.contains("\"package_name\":\"com.example.application\""))
    }

    @Test
    fun roundTripsDeliveryRequest() {
        val message: ControlMessage = validRequest()
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        val decoded = ProtocolJson.decode(json, Limits()).getOrThrow()
        assertEquals(message, decoded)
    }

    @Test
    fun roundTripsNotificationMode() {
        val message: ControlMessage =
            validRequest().copy(presentation = Presentation(PresentationMode.NOTIFICATION))
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        assertTrue(json.contains("\"mode\":\"NOTIFICATION\""))
        assertEquals(message, ProtocolJson.decode(json, Limits()).getOrThrow())
    }

    @Test
    fun roundTripsDeliveryResponse() {
        val message: ControlMessage = DeliveryResponse(RequestId("req_01JTEST"), Decision.ACCEPT)
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        val decoded = ProtocolJson.decode(json, Limits()).getOrThrow()
        assertEquals(message, decoded)
    }

    @Test
    fun roundTripsErrorMessage() {
        val message: ControlMessage =
            ErrorMessage(RequestId("req_01JTEST"), ErrorCode.INTEGRITY_MISMATCH, "Verification failed.")
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        val decoded = ProtocolJson.decode(json, Limits()).getOrThrow()
        assertEquals(message, decoded)
    }

    @Test
    fun decodesValidJson() {
        val message = validRequest()
        val json = ProtocolJson.encode(message, Limits()).getOrThrow()
        val decoded = ProtocolJson.decode(json, Limits()).getOrThrow()
        assertTrue(decoded is DeliveryRequest)
    }

    @Test
    fun rejectsEmptyString() {
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode("", Limits()).getOrThrow() }
    }

    @Test
    fun rejectsArrayInput() {
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode("[]", Limits()).getOrThrow() }
    }

    @Test
    fun rejectsNullInput() {
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode("null", Limits()).getOrThrow() }
    }

    @Test
    fun rejectsBooleanInput() {
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode("true", Limits()).getOrThrow() }
    }

    @Test
    fun rejectsEmptyObject() {
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode("{}", Limits()).getOrThrow() }
    }

    @Test
    fun rejectsUnknownType() {
        val json = """{"type":"unknown","request_id":"req_01JTEST"}"""
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode(json, Limits()).getOrThrow() }
    }

    @Test
    fun rejectsUnknownTopLevelField() {
        val json = """{"type":"delivery_response","request_id":"req_01JTEST","decision":"ACCEPT","extra":1}"""
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode(json, Limits()).getOrThrow() }
    }

    @Test
    fun rejectsMissingApplicationField() {
        val json =
            """{"type":"delivery_request","protocol_version":1,"request_id":"req_01JTEST","session_id":"sess_01JTEST","presentation":{"mode":"GUI"},"sender":{"display_name":"Test"}}"""
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode(json, Limits()).getOrThrow() }
    }

    @Test
    fun rejectsInvalidEnumValue() {
        val json =
            """{"type":"delivery_request","protocol_version":1,"request_id":"req_01JTEST","session_id":"sess_01JTEST","presentation":{"mode":"MAYBE"},"sender":{"display_name":"Test"},"application":{"name":"a","version":"1","description":"","package_name":"com.example.app","size_bytes":1,"sha256":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}}"""
        assertThrows(ProtocolProblem::class.java) { ProtocolJson.decode(json, Limits()).getOrThrow() }
    }

    @Test
    fun rejectsUnsupportedProtocolVersion() {
        val message: ControlMessage = validRequest().copy(protocolVersion = ProtocolVersion(2))
        val problem = assertThrows(ProtocolProblem::class.java) { ProtocolJson.encode(message, Limits()).getOrThrow() }
        assertEquals(ErrorCode.UNSUPPORTED_PROTOCOL, problem.code)
    }

    @Test
    fun rejectsInvalidRequestInEncoder() {
        val message: ControlMessage = validRequest().copy(
            sender = SenderProfile("   "),
        )
        val problem = assertThrows(ProtocolProblem::class.java) { ProtocolJson.encode(message, Limits()).getOrThrow() }
        assertEquals(ErrorCode.INVALID_METADATA, problem.code)
    }
}