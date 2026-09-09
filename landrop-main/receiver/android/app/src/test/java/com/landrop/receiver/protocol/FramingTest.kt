package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class FramingTest {

    private fun text(s: String) = s.toByteArray(Charsets.UTF_8)

    private fun fromHex(hex: String): ByteArray {
        require(hex.length % 2 == 0)
        return ByteArray(hex.length / 2) { index -> hex.substring(index * 2, index * 2 + 2).toInt(16).toByte() }
    }

    private fun toHex(bytes: ByteArray): String = bytes.joinToString("") { "%02x".format(it) }

    private fun frame(s: String): ByteArray =
        (encodeFrame(text(s)) as FrameEncodeResult.Ok).bytes

    private fun drain(packet: ByteArray): List<String> {
        val decoder = FrameDecoder()
        decoder.feed(packet)
        val out = mutableListOf<String>()
        while (true) {
            when (val result = decoder.tryReadFrame()) {
                is FrameResult.Frame -> out.add(String(result.payload, Charsets.UTF_8))
                is FrameResult.Incomplete -> break
                is FrameResult.Error -> error("unexpected framing error ${result.problem}")
            }
        }
        assertEquals(StreamEndResult.Ok, decoder.endOfStream())
        return out
    }

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
    fun fixturePayloadsRoundTrip() {
        val payloads = listOf(
            "empty" to "",
            "error_integrity" to errorIntegrity,
            "response_accept" to responseAccept,
            "request_gui" to requestGui,
        )
        for ((name, payload) in payloads) {
            val encoded = frame(payload)
            assertEquals(FRAME_LENGTH_BYTES + payload.toByteArray(Charsets.UTF_8).size, encoded.size)
            val length = readLength(encoded.copyOfRange(0, FRAME_LENGTH_BYTES))
            assertEquals(payload.toByteArray(Charsets.UTF_8).size.toLong(), length)
            val decoder = FrameDecoder()
            decoder.feed(encoded)
            when (val result = decoder.tryReadFrame()) {
                is FrameResult.Frame -> assertEquals(payload, String(result.payload, Charsets.UTF_8))
                else -> error("expected frame for $name, got $result")
            }
        }
    }

    @Test
    fun zeroLengthFrameIsNotAProblem() {
        val encoded = frame("")
        assertEquals("00000000", toHex(encoded))
        val decoder = FrameDecoder()
        decoder.feed(encoded)
        val result = decoder.tryReadFrame()
        assertTrue(result is FrameResult.Frame)
        if (result is FrameResult.Frame) assertTrue(result.payload.isEmpty())
        assertEquals(StreamEndResult.Ok, decoder.endOfStream())
    }

    @Test
    fun maxBoundaryIsExact() {
        assertTrue(encodeFrame(ByteArray(MAX_FRAME_PAYLOAD_BYTES)) is FrameEncodeResult.Ok)
        assertEquals(
            FrameEncodeResult.Failing(FrameProblem.FRAME_TOO_LARGE),
            encodeFrame(ByteArray(MAX_FRAME_PAYLOAD_BYTES + 1)),
        )
    }

    @Test
    fun twoBackToBackFramesInOneFeed() {
        val packet = frame(responseAccept) + frame(errorIntegrity)
        assertEquals(listOf(responseAccept, errorIntegrity), drain(packet))
    }

    @Test
    fun anyByteSplitStillYieldsTheFrame() {
        val whole = frame(responseAccept)
        for (k in 0..whole.size) {
            val decoder = FrameDecoder()
            decoder.feed(whole.copyOf(k))
            while (true) {
                when (val result = decoder.tryReadFrame()) {
                    is FrameResult.Frame -> assertEquals(responseAccept, String(result.payload, Charsets.UTF_8))
                    is FrameResult.Incomplete -> break
                    is FrameResult.Error -> error("split $k error ${result.problem}")
                }
            }
            decoder.feed(whole.copyOfRange(k, whole.size))
            while (true) {
                when (val result = decoder.tryReadFrame()) {
                    is FrameResult.Frame -> assertEquals(responseAccept, String(result.payload, Charsets.UTF_8))
                    is FrameResult.Incomplete -> break
                    is FrameResult.Error -> error("split tail $k error ${result.problem}")
                }
            }
            assertEquals("split $k", StreamEndResult.Ok, decoder.endOfStream())
        }
    }

    @Test
    fun trailingInputIsTruncated() {
        for (hexInput in listOf("aabb", "00000004aa")) {
            val decoder = FrameDecoder()
            decoder.feed(fromHex(hexInput))
            assertEquals(FrameResult.Incomplete, decoder.tryReadFrame())
            assertEquals(StreamEndResult.Error(FrameProblem.TRUNCATED), decoder.endOfStream())
        }
    }

    @Test
    fun emptyInputIsNotAProblem() {
        val decoder = FrameDecoder()
        assertEquals(FrameResult.Incomplete, decoder.tryReadFrame())
        assertEquals(StreamEndResult.Ok, decoder.endOfStream())
    }

    @Test
    fun oversizedAndWildLengthsAreStablyFrameTooLarge() {
        for (hexInput in listOf("00020000aabb", "ffffffff")) {
            val decoder = FrameDecoder()
            decoder.feed(fromHex(hexInput))
            assertEquals(
                FrameResult.Error(FrameProblem.FRAME_TOO_LARGE),
                decoder.tryReadFrame(),
            )
            // Deterministic: the error repeats and later input cannot change it.
            assertEquals(
                FrameResult.Error(FrameProblem.FRAME_TOO_LARGE),
                decoder.tryReadFrame(),
            )
            assertEquals(
                StreamEndResult.Error(FrameProblem.FRAME_TOO_LARGE),
                decoder.endOfStream(),
            )
        }
    }

    @Test
    fun conservesBytesAcrossByteByByteFeeds() {
        val packet = frame(responseAccept) + frame(errorIntegrity)
        val decoder = FrameDecoder()
        val emitted = mutableListOf<String>()
        for (byte in packet) {
            decoder.feed(byteArrayOf(byte))
            while (true) {
                when (val result = decoder.tryReadFrame()) {
                    is FrameResult.Frame -> emitted.add(String(result.payload, Charsets.UTF_8))
                    is FrameResult.Incomplete -> break
                    is FrameResult.Error -> error("unexpected framing error ${result.problem}")
                }
            }
        }
        assertEquals(listOf(responseAccept, errorIntegrity), emitted)
        assertEquals(2, decoder.emittedFrameCount)
        assertEquals(
            (responseAccept.length + errorIntegrity.length).toLong(),
            decoder.emittedPayloadBytes,
        )
        assertTrue(decoder.isBalanced)
    }

    private fun readLength(bytes: ByteArray): Long {
        var value = 0L
        for (byte in bytes) value = (value shl 8) or (byte.toLong() and 0xff)
        return value
    }
}