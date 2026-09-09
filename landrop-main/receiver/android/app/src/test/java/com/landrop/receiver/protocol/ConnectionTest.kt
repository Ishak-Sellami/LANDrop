package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ConnectionTest {

    @Test
    fun matchesFixtureOutcomeVocabulary() {
        assertEquals(
            listOf(
                ConnectionOutcome.ESTABLISHED,
                ConnectionOutcome.REFUSED,
                ConnectionOutcome.TIMEOUT,
                ConnectionOutcome.CLOSED,
                ConnectionOutcome.IO_ERROR,
            ),
            CONNECTION_OUTCOMES,
        )
    }

    @Test
    fun beginEmitsConnectInitiatedExactlyOnce() {
        val attempt = ConnectionAttempt()
        assertEquals(DeliveryEvent.CONNECT_INITIATED, attempt.begin())
        assertEquals(ConnectionPhase.CONNECTING, attempt.phase)
        assertNull(attempt.begin())
        assertEquals(listOf(DeliveryEvent.CONNECT_INITIATED), attempt.events())
    }

    @Test
    fun establishesWithoutEmittingADeliveryEvent() {
        val attempt = ConnectionAttempt()
        attempt.begin()
        assertNull(attempt.complete(ConnectionOutcome.ESTABLISHED))
        assertEquals(ConnectionPhase.ESTABLISHED, attempt.phase)
        assertNull(attempt.lastFailure)
    }

    @Test
    fun mapsEveryConnectionFailurePerFixture() {
        val cases = listOf(
            ConnectionOutcome.REFUSED to TransportFailure(TransportErrorKind.IO_ERROR, "connection refused"),
            ConnectionOutcome.TIMEOUT to TransportFailure(TransportErrorKind.TIMEOUT, "connection timed out"),
            ConnectionOutcome.CLOSED to TransportFailure(TransportErrorKind.CONNECTION_LOST, "connection closed"),
            ConnectionOutcome.IO_ERROR to TransportFailure(TransportErrorKind.IO_ERROR, "transport I/O error"),
        )
        for ((outcome, expected) in cases) {
            assertEquals(expected, connectionFailure(outcome))
        }
    }

    @Test
    fun failingAnAttemptEmitsConnectionLostOnceAndKeepsFailure() {
        for (outcome in listOf(ConnectionOutcome.REFUSED, ConnectionOutcome.TIMEOUT, ConnectionOutcome.CLOSED, ConnectionOutcome.IO_ERROR)) {
            val attempt = ConnectionAttempt()
            attempt.begin()
            assertEquals(DeliveryEvent.CONNECTION_LOST, attempt.complete(outcome))
            assertEquals(ConnectionPhase.FAILED, attempt.phase)
            assertEquals(connectionFailure(outcome), attempt.lastFailure)
            assertNull(attempt.complete(outcome))
            assertEquals(listOf(DeliveryEvent.CONNECT_INITIATED, DeliveryEvent.CONNECTION_LOST), attempt.events())
        }
    }

    @Test
    fun establishedConnectionIsFinalized() {
        val attempt = ConnectionAttempt()
        attempt.begin()
        attempt.complete(ConnectionOutcome.ESTABLISHED)
        assertNull(attempt.complete(ConnectionOutcome.ESTABLISHED))
        assertNull(attempt.complete(ConnectionOutcome.REFUSED))
        assertEquals(ConnectionPhase.ESTABLISHED, attempt.phase)
    }

    @Test
    fun closeIsDeterministicAndIdempotentFromAnyPhase() {
        for (finalPhase in listOf(ConnectionPhase.CONNECTING, ConnectionPhase.ESTABLISHED)) {
            val attempt = ConnectionAttempt()
            attempt.begin()
            if (finalPhase == ConnectionPhase.ESTABLISHED) attempt.complete(ConnectionOutcome.ESTABLISHED)
            assertEquals(DeliveryEvent.CONNECTION_LOST, attempt.close())
            assertEquals(ConnectionPhase.CLOSED, attempt.phase)
            assertNull(attempt.close())
        }
        val failed = ConnectionAttempt()
        failed.begin()
        failed.complete(ConnectionOutcome.TIMEOUT)
        assertNull(failed.close())
    }

    @Test
    fun reproducesFixtureConnectionCasesDeterministically() {
        fun scenario(name: String): List<DeliveryEvent> {
            val attempt = ConnectionAttempt()
            attempt.begin()
            when (name) {
                "established_then_lost" -> {
                    attempt.complete(ConnectionOutcome.ESTABLISHED)
                    attempt.close()
                }
                "refused" -> attempt.complete(ConnectionOutcome.REFUSED)
                "timeout" -> attempt.complete(ConnectionOutcome.TIMEOUT)
                "immediate_close" -> attempt.close()
                "io_error" -> attempt.complete(ConnectionOutcome.IO_ERROR)
            }
            return attempt.events()
        }
        val expected = listOf(DeliveryEvent.CONNECT_INITIATED, DeliveryEvent.CONNECTION_LOST)
        for (name in listOf("established_then_lost", "refused", "timeout", "immediate_close", "io_error")) {
            assertEquals(expected, scenario(name))
            assertEquals(expected, scenario(name))
        }
    }
}