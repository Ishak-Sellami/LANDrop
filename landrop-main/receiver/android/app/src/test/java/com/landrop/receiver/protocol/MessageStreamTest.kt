package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MessageStreamTest {

    private fun text(s: String) = s.toByteArray(Charsets.UTF_8)

    private fun frame(s: String): ByteArray =
        (encodeFrame(text(s)) as FrameEncodeResult.Ok).bytes

    private val errorIntegrity =
        "{\"type\":\"error\",\"request_id\":\"req_01JTEST\",\"code\":\"INTEGRITY_MISMATCH\"," +
            "\"message\":\"Received file failed integrity verification.\"}"
    private val responseAccept =
        "{\"type\":\"delivery_response\",\"request_id\":\"req_01JTEST\",\"decision\":\"ACCEPT\"}"
    private val requestGui =
        "{\"type\":\"delivery_request\",\"protocol_version\":1,\"request_id\":\"req_01JTEST\"," +
            "\"session_id\":\"sess_01JTEST\",\"presentation\":{\"mode\":\"GUI\"}," +
            "\"sender\":{\"display_name\":\"ISHAQ CYBERTECH\"}," +
            "\"application\":{\"name\":\"My Application\",\"version\":\"1.4.2\"," +
            "\"description\":\"A local test application.\",\"package_name\":\"com.example.application\"," +
            "\"size_bytes\":26004608,\"sha256\":\"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\"}}"

    @Test
    fun decodesSharedPayloadsToTypedMessages() {
        val stream = JsonMessageStream()
        stream.feed(frame(errorIntegrity))
        when (val result = stream.readMessage()) {
            is JsonMessageResult.Message -> {
                val message = result.message as ErrorMessage
                assertEquals(ErrorCode.INTEGRITY_MISMATCH, message.code)
            }
            else -> error("expected message, got $result")
        }

        val accept = JsonMessageStream()
        accept.feed(frame(responseAccept))
        when (val result = accept.readMessage()) {
            is JsonMessageResult.Message -> {
                val message = result.message as DeliveryResponse
                assertEquals(Decision.ACCEPT, message.decision)
            }
            else -> error("expected message, got $result")
        }

        val gui = JsonMessageStream()
        gui.feed(frame(requestGui))
        when (val result = gui.readMessage()) {
            is JsonMessageResult.Message -> {
                val message = result.message as DeliveryRequest
                assertEquals(PresentationMode.GUI, message.presentation.mode)
                assertEquals("com.example.application", message.application.identity.packageName)
            }
            else -> error("expected message, got $result")
        }
    }

    @Test
    fun byteByBytePacketEmitsMessagesInOrder() {
        val packet = frame(errorIntegrity) + frame(responseAccept)
        val stream = JsonMessageStream()
        for (byte in packet) stream.feed(byteArrayOf(byte))
        val kinds = mutableListOf<String>()
        while (true) {
            when (val result = stream.readMessage()) {
                is JsonMessageResult.Message -> {
                    when (result.message) {
                        is ErrorMessage -> kinds.add("error")
                        is DeliveryResponse -> kinds.add("response")
                        is DeliveryRequest -> kinds.add("request")
                    }
                }
                is JsonMessageResult.Incomplete -> break
                is JsonMessageResult.FrameError -> error("unexpected frame error ${result.problem}")
                is JsonMessageResult.ProtocolError -> error("unexpected protocol error ${result.problem}")
            }
        }
        assertEquals(listOf("error", "response"), kinds)
        assertEquals(StreamEndResult.Ok, stream.endOfStream())
    }

    @Test
    fun partialFinalHeaderIsIncompleteThenTruncated() {
        val stream = JsonMessageStream()
        stream.feed(frame(responseAccept))
        assertTrue(stream.readMessage() is JsonMessageResult.Message)
        stream.feed(byteArrayOf(0x00, 0x00, 0x00))
        assertEquals(JsonMessageResult.Incomplete, stream.readMessage())
        assertEquals(StreamEndResult.Error(FrameProblem.TRUNCATED), stream.endOfStream())
    }

    @Test
    fun oversizedLengthIsFrameError() {
        val stream = JsonMessageStream()
        stream.feed(byteArrayOf(0x00, 0x02, 0x00, 0x00))
        stream.feed(byteArrayOf(0xaa.toByte(), 0xbb.toByte()))
        assertEquals(
            JsonMessageResult.FrameError(FrameProblem.FRAME_TOO_LARGE),
            stream.readMessage(),
        )
    }

    @Test
    fun emptyPayloadMapsToInvalidRequest() {
        val stream = JsonMessageStream()
        stream.feed(byteArrayOf(0x00, 0x00, 0x00, 0x00))
        when (val result = stream.readMessage()) {
            is JsonMessageResult.ProtocolError -> assertEquals(ErrorCode.INVALID_REQUEST, result.problem.code)
            else -> error("expected protocol error, got $result")
        }
    }

    @Test
    fun malformedJsonMapsToInvalidRequest() {
        val stream = JsonMessageStream()
        stream.feed(frame("{"))
        when (val result = stream.readMessage()) {
            is JsonMessageResult.ProtocolError -> assertEquals(ErrorCode.INVALID_REQUEST, result.problem.code)
            else -> error("expected protocol error, got $result")
        }
    }

    @Test
    fun invalidUtf8MapsToInvalidRequestJson() {
        val stream = JsonMessageStream()
        stream.feed(byteArrayOf(0x00, 0x00, 0x00, 0x02, 0x80.toByte(), 0xf1.toByte()))
        when (val result = stream.readMessage()) {
            is JsonMessageResult.ProtocolError -> {
                assertEquals(ErrorCode.INVALID_REQUEST, result.problem.code)
                assertEquals("json", result.problem.field)
            }
            else -> error("expected protocol error, got $result")
        }
    }

    @Test
    fun encodeRoundTrip() {
        val request = DeliveryRequest(
            ProtocolVersion(1),
            RequestId("req_01JTEST"),
            SessionId("sess_01JTEST"),
            Presentation(PresentationMode.GUI),
            SenderProfile("ISHAQ CYBERTECH"),
            ApplicationMetadata(
                ApkIdentity(
                    "com.example.application",
                    26004608,
                    Sha256("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"),
                ),
                ApplicationPresentation("My Application", "1.4.2", "A local test application."),
            ),
        )
        val encoded = encodeJsonFrame(request)
        assertTrue(encoded is JsonFrameEncodeResult.Ok)
        val stream = JsonMessageStream()
        stream.feed((encoded as JsonFrameEncodeResult.Ok).bytes)
        assertEquals(JsonMessageResult.Message(request), stream.readMessage())
    }

    @Test
    fun transportIntegration() {
        val packet = frame(requestGui)
        val (left, right) = createInMemoryDuplex()
        left.write(packet)
        left.close()

        val stream = JsonMessageStream()
        while (true) {
            when (val read = right.read(FRAME_LENGTH_BYTES + 64)) {
                is TransportRead.Data -> stream.feed(read.bytes)
                is TransportRead.End -> break
                else -> error("unexpected transport read $read")
            }
        }
        when (val result = stream.readMessage()) {
            is JsonMessageResult.Message -> {
                val message = result.message as DeliveryRequest
                assertEquals("ISHAQ CYBERTECH", message.sender.displayName)
            }
            else -> error("expected message, got $result")
        }
        assertEquals(StreamEndResult.Ok, stream.endOfStream())
    }
}