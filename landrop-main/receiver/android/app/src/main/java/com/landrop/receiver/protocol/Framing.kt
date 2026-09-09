package com.landrop.receiver.protocol

import java.util.ArrayDeque

// Wire framing — 4-byte big-endian length prefix + JSON payload.
// The protocol spec does not define a frame structure (SPECIFICATION GAP,
// resolved here and fixed in the shared fixtures). max_payload_bytes reuses
// the codec's maxJsonBytes (65536) so no new magic numbers appear.
// A framing problem is a LOCAL defect (corrupt/oversized/truncated stream),
// never a wire ErrorCode.

const val FRAME_LENGTH_BYTES = 4

// Mirrors Limits().maxJsonBytes.
const val MAX_FRAME_PAYLOAD_BYTES = 65536

enum class FrameProblem { FRAME_TOO_LARGE, TRUNCATED }

sealed class FrameResult {
    data class Frame(val payload: ByteArray) : FrameResult()
    object Incomplete : FrameResult()
    data class Error(val problem: FrameProblem) : FrameResult()
}

sealed class FrameEncodeResult {
    data class Ok(val bytes: ByteArray) : FrameEncodeResult()
    data class Failing(val problem: FrameProblem) : FrameEncodeResult()
}

fun encodeFrame(payload: ByteArray): FrameEncodeResult {
    if (payload.size > MAX_FRAME_PAYLOAD_BYTES) return FrameEncodeResult.Failing(FrameProblem.FRAME_TOO_LARGE)
    return FrameEncodeResult.Ok(lengthPrefix(payload.size) + payload)
}

private fun lengthPrefix(size: Int): ByteArray {
    val bytes = ByteArray(FRAME_LENGTH_BYTES)
    var value = size
    for (i in FRAME_LENGTH_BYTES - 1 downTo 0) {
        bytes[i] = (value and 0xff).toByte()
        value = value ushr 8
    }
    return bytes
}

private fun readUint32BE(bytes: ByteArray): Long {
    var value = 0L
    for (byte in bytes) value = (value shl 8) or (byte.toLong() and 0xff)
    return value
}

// Incremental frame assembler. Feed the stream in any chunk split; call
// tryReadFrame() repeatedly until incomplete; call endOfStream() once the
// peer EOFs to surface a trailing TRUNCATED frame (message boundaries are
// length-defined, so trailing bytes always mean a broken stream).
class FrameDecoder(private val maxPayloadBytes: Int = MAX_FRAME_PAYLOAD_BYTES) {
    private val chunks = ArrayDeque<ByteArray>()
    private var buffered = 0L
    private var broken: FrameProblem? = null
    private var fed = 0L
    private var emittedHeaders = 0L
    private var emittedPayload = 0L

    val totalFedBytes: Long
        get() = fed

    val emittedFrameCount: Long
        get() = emittedHeaders / FRAME_LENGTH_BYTES

    val emittedPayloadBytes: Long
        get() = emittedPayload

    val bufferedBytes: Long
        get() = buffered

    // Conservation invariant: fed == emittedHeaders + emittedPayload + buffered.
    val isBalanced: Boolean
        get() = fed == emittedHeaders + emittedPayload + buffered

    fun feed(chunk: ByteArray) {
        if (chunk.isEmpty()) return
        fed += chunk.size
        chunks.add(chunk)
        buffered += chunk.size
    }

    private fun peek(n: Long): ByteArray? {
        if (buffered < n) return null
        val out = ByteArray(n.toInt())
        var remaining = n
        for (head in chunks) {
            if (remaining == 0) break
            if (head.isEmpty()) continue
            val take = minOf(head.size.toLong(), remaining).toInt()
            head.copyInto(out, (n - remaining).toInt(), 0, take)
            remaining -= take
        }
        return out
    }

    private fun drop(n: Long) {
        var remaining = n
        while (remaining > 0) {
            val head = chunks.pollFirst() ?: error("framing drop underrun")
            if (head.size.toLong() <= remaining) {
                remaining -= head.size
            } else {
                chunks.addFirst(head.copyOfRange(remaining.toInt(), head.size))
                remaining = 0
            }
        }
        buffered -= n
    }

    fun tryReadFrame(): FrameResult {
        val brokenNow = broken
        if (brokenNow != null) return FrameResult.Error(brokenNow)
        val header = peek(FRAME_LENGTH_BYTES.toLong()) ?: return FrameResult.Incomplete
        val length = readUint32BE(header)
        if (length > maxPayloadBytes) {
            broken = FrameProblem.FRAME_TOO_LARGE
            return FrameResult.Error(FrameProblem.FRAME_TOO_LARGE)
        }
        if (buffered < FRAME_LENGTH_BYTES + length) return FrameResult.Incomplete
        drop(FRAME_LENGTH_BYTES.toLong())
        val payload = peek(length) ?: run {
            broken = FrameProblem.TRUNCATED
            return FrameResult.Error(FrameProblem.TRUNCATED)
        }
        drop(length)
        emittedHeaders += FRAME_LENGTH_BYTES
        emittedPayload += length
        return FrameResult.Frame(payload)
    }

    fun endOfStream(): StreamEndResult {
        val brokenNow = broken
        if (brokenNow != null) return StreamEndResult.Error(brokenNow)
        return if (buffered > 0) StreamEndResult.Error(FrameProblem.TRUNCATED) else StreamEndResult.Ok
    }
}

sealed class StreamEndResult {
    object Ok : StreamEndResult()
    data class Error(val problem: FrameProblem) : StreamEndResult()
}