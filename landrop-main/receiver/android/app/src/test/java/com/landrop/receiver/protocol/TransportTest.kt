package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TransportTest {

    private fun text(s: String) = s.toByteArray(Charsets.UTF_8)

    private fun data(read: TransportRead): ByteArray =
        (read as? TransportRead.Data)?.bytes ?: error("expected Data, found $read")

    @Test
    fun deliversWritesToThePeerInOrder() {
        val (left, right) = createInMemoryDuplex()
        assertEquals(TransportResult.Ok, left.connect())
        assertEquals(TransportResult.Ok, right.connect())

        assertEquals(TransportResult.Ok, left.write(text("aa")))
        assertEquals(TransportResult.Ok, left.write(text("bb")))

        assertEquals("aabb", String(data(right.read(16)), Charsets.UTF_8))
        assertEquals(TransportRead.Empty, right.read(16))
    }

    @Test
    fun emptyWhileOpenAndEndAfterPeerCloses() {
        val (left, right) = createInMemoryDuplex()
        assertEquals(TransportRead.Empty, right.read(4))
        left.close()
        assertTrue(left.write(text("x")) is TransportResult.Failure)
        assertEquals(TransportRead.End, right.read(4))
    }

    @Test
    fun drainsBufferedDataBeforeReportingEnd() {
        val (left, right) = createInMemoryDuplex()
        left.write(text("payload"))
        left.close()
        assertEquals("payload", String(data(right.read(64)), Charsets.UTF_8))
        assertEquals(TransportRead.End, right.read(64))
    }

    @Test
    fun respectsMaxBytesAndPreservesBytesAcrossReads() {
        val (left, right) = createInMemoryDuplex()
        left.write(text("0123456789"))
        assertEquals("0123", String(data(right.read(4)), Charsets.UTF_8))
        assertEquals("456789", String(data(right.read(64)), Charsets.UTF_8))
    }

    @Test
    fun copiesWritesSoTheCallerMayReuseItsBuffer() {
        val (left, right) = createInMemoryDuplex()
        val buf = text("abc")
        left.write(buf)
        buf[0] = 'X'.code.toByte() // must not affect the transported copy
        assertEquals("abc", String(data(right.read(3)), Charsets.UTF_8))
    }

    @Test
    fun ioErrorsAgainstTheClosedLocalEnd() {
        val (left, right) = createInMemoryDuplex()
        left.write(text("x"))
        left.close()
        assertTrue(left.read(4) is TransportRead.Error)
        assertTrue(left.write(text("y")) is TransportResult.Failure)
        assertTrue(left.connect() is TransportResult.Failure)
        assertTrue(left.isClosed)
        // The peer still sees data, then end.
        assertEquals("x", String(data(right.read(4)), Charsets.UTF_8))
        assertEquals(TransportRead.End, right.read(4))
    }

    @Test
    fun rejectsANonPositiveMaxBytes() {
        val (left, _) = createInMemoryDuplex()
        assertTrue(left.read(0) is TransportRead.Error)
        assertTrue(left.read(-1) is TransportRead.Error)
    }

    @Test
    fun closeIsIdempotent() {
        val (left, right) = createInMemoryDuplex()
        left.close()
        left.close()
        assertTrue(left.isClosed)
        right.close()
        right.close()
        assertTrue(right.isClosed)
        // Reading on a locally-closed transport is an error, not EOF.
        assertTrue(right.read(1) is TransportRead.Error)
    }
}