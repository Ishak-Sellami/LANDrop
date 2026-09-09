package com.landrop.receiver.protocol

import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

// Message boundary: transport bytes -> frames -> codec -> protocol messages.
// This is where the abstract Transport meets the Phase 02 codec. It is
// transport-agnostic: callers feed bytes (e.g. from Transport.read) and read
// complete ControlMessages out the other side.

sealed class JsonMessageResult {
    data class Message(val message: ControlMessage) : JsonMessageResult()
    object Incomplete : JsonMessageResult()
    data class FrameError(val problem: FrameProblem) : JsonMessageResult()
    data class ProtocolError(val problem: ProtocolProblem) : JsonMessageResult()
}

sealed class JsonFrameEncodeResult {
    data class Ok(val bytes: ByteArray) : JsonFrameEncodeResult()
    data class Failing(val problem: ProtocolProblem) : JsonFrameEncodeResult()
}

class JsonMessageStream(
    private val limits: Limits = Limits(),
    maxFramePayloadBytes: Int = MAX_FRAME_PAYLOAD_BYTES,
) {
    private val decoder = FrameDecoder(maxFramePayloadBytes)

    fun feed(chunk: ByteArray) = decoder.feed(chunk)

    fun readMessage(): JsonMessageResult = when (val frame = decoder.tryReadFrame()) {
        is FrameResult.Incomplete -> JsonMessageResult.Incomplete
        is FrameResult.Error -> JsonMessageResult.FrameError(frame.problem)
        is FrameResult.Frame -> {
            // Non-UTF-8 payload: normalize into the codec's malformed-JSON
            // problem rather than leaking a raw decoder exception.
            val text = strictUtf8(frame.payload)
                ?: return JsonMessageResult.ProtocolError(ProtocolProblem(ErrorCode.INVALID_REQUEST, "json"))
            when (val decoded = ProtocolJson.decode(text, limits)) {
                is Result.Success -> JsonMessageResult.Message(decoded.value)
                is Result.Failure -> {
                    val cause = decoded.exceptionOrNull()
                    if (cause is ProtocolProblem) {
                        JsonMessageResult.ProtocolError(cause)
                    } else {
                        JsonMessageResult.ProtocolError(ProtocolProblem(ErrorCode.INVALID_REQUEST, "json"))
                    }
                }
            }
        }
    }

    fun endOfStream(): StreamEndResult = decoder.endOfStream()

    val bufferedBytes: Long
        get() = decoder.bufferedBytes

    val isBalanced: Boolean
        get() = decoder.isBalanced
}

// Strict UTF-8 with reporting: malformed byte sequences yield null instead of
// replacement characters, matching the TS and Rust decoders.
private fun strictUtf8(bytes: ByteArray): String? = try {
    Charsets.UTF_8.newDecoder()
        .onMalformedInput(CodingErrorAction.REPORT)
        .onUnmappableCharacter(CodingErrorAction.REPORT)
        .decode(ByteBuffer.wrap(bytes))
        .toString()
} catch (_: java.nio.charset.CharacterCodingException) {
    null
}

// Encode a typed message into a single wire frame (JSON payload). The codec
// already bounds the JSON at maxJsonBytes, which equals the frame payload
// limit, so a validated message always fits one frame.
fun encodeJsonFrame(message: ControlMessage, limits: Limits = Limits()): JsonFrameEncodeResult =
    when (val json = ProtocolJson.encode(message, limits)) {
        is Result.Success -> {
            val encoded = encodeFrame(json.value.toByteArray(Charsets.UTF_8))
            when (encoded) {
                is FrameEncodeResult.Ok -> JsonFrameEncodeResult.Ok(encoded.bytes)
                is FrameEncodeResult.Failing -> {
                    // Unreachable in practice: validated JSON is bounded by maxJsonBytes.
                    JsonFrameEncodeResult.Failing(ProtocolProblem(ErrorCode.INVALID_REQUEST, "json.size"))
                }
            }
        }
        is Result.Failure -> JsonFrameEncodeResult.Failing(
            json.exceptionOrNull() as? ProtocolProblem
                ?: ProtocolProblem(ErrorCode.INVALID_REQUEST, "json"),
        )
    }