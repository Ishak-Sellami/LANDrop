package com.landrop.receiver.protocol

import java.util.ArrayDeque

enum class TransportErrorKind { CONNECTION_LOST, TIMEOUT, IO_ERROR }

data class TransportFailure(val kind: TransportErrorKind, val message: String)

sealed class TransportResult {
    object Ok : TransportResult()
    data class Failure(val error: TransportFailure) : TransportResult()
}

sealed class TransportRead {
    data class Data(val bytes: ByteArray) : TransportRead()
    object Empty : TransportRead()
    object End : TransportRead()
    data class Error(val error: TransportFailure) : TransportRead()
}

interface Transport {
    fun connect(): TransportResult
    fun read(maxBytes: Int): TransportRead
    fun write(bytes: ByteArray): TransportResult
    fun close()

    /** True once close() has been called on this side. */
    val isClosed: Boolean
}

private fun ioError(message: String) = TransportFailure(TransportErrorKind.IO_ERROR, message)

private class SharedBuffer {
    val chunks = ArrayDeque<ByteArray>()
    var size = 0L

    /** True once the peer that feeds this buffer has closed its side. */
    var peerClosed = false
}

// Deterministic in-memory pipe for tests and offline integration. left writes
// into the buffer right reads and vice versa; closing one end surfaces as
// End on the other once its buffer drains.
class InMemoryTransport internal constructor(
    private val incoming: SharedBuffer,
    private val outgoing: SharedBuffer,
    private val markPeerClosed: () -> Unit,
) : Transport {

    private var closed = false

    override fun connect(): TransportResult =
        if (closed) TransportResult.Failure(ioError("connect on closed transport")) else TransportResult.Ok

    override val isClosed: Boolean
        get() = closed

    override fun read(maxBytes: Int): TransportRead {
        if (closed) return TransportRead.Error(ioError("read on closed transport"))
        if (maxBytes <= 0) return TransportRead.Error(ioError("read requires maxBytes > 0"))
        if (incoming.size > 0) {
            val take = minOf(maxBytes.toLong(), incoming.size).toInt()
            val out = ByteArray(take)
            var index = 0
            while (index < take) {
                val head = incoming.chunks.peekFirst()
                if (head == null || head.isEmpty()) {
                    incoming.chunks.pollFirst()
                    continue
                }
                val amount = minOf(head.size, take - index)
                head.copyInto(out, index, 0, amount)
                if (amount == head.size) {
                    incoming.chunks.pollFirst()
                } else {
                    incoming.chunks.pollFirst()
                    incoming.chunks.addFirst(head.copyOfRange(amount, head.size))
                }
                index += amount
            }
            incoming.size -= take
            return TransportRead.Data(out)
        }
        return if (incoming.peerClosed) TransportRead.End else TransportRead.Empty
    }

    override fun write(bytes: ByteArray): TransportResult {
        if (closed) return TransportResult.Failure(ioError("write on closed transport"))
        outgoing.chunks.add(bytes.copyOf())
        outgoing.size += bytes.size
        return TransportResult.Ok
    }

    override fun close() {
        if (closed) return
        closed = true
        markPeerClosed()
    }
}

fun createInMemoryDuplex(): Pair<InMemoryTransport, InMemoryTransport> {
    val toLeft = SharedBuffer()
    val toRight = SharedBuffer()
    val left = InMemoryTransport(toLeft, toRight) { toRight.peerClosed = true }
    val right = InMemoryTransport(toRight, toLeft) { toLeft.peerClosed = true }
    return left to right
}