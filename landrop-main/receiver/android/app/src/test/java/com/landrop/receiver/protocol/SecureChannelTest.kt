package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SecureChannelTest {

    @Test
    fun matchesFixtureOutcomeVocabulary() {
        assertEquals(
            listOf(
                SecureChannelOutcome.ESTABLISHED,
                SecureChannelOutcome.HANDSHAKE_FAILURE,
                SecureChannelOutcome.VALIDATION_FAILURE,
                SecureChannelOutcome.TIMEOUT,
                SecureChannelOutcome.CLOSED,
            ),
            SECURE_CHANNEL_OUTCOMES,
        )
    }

    @Test
    fun handshakePhaseEmitsNoDeliveryEvent() {
        val channel = SecureChannelAttempt()
        channel.begin()
        assertEquals(SecureChannelPhase.TLS, channel.phase)
    }

    @Test
    fun establishesSecureChannelAndEmitsEvent() {
        val channel = SecureChannelAttempt()
        channel.begin()
        assertEquals(DeliveryEvent.SECURE_CHANNEL_ESTABLISHED, channel.complete(SecureChannelOutcome.ESTABLISHED))
        assertEquals(SecureChannelPhase.ESTABLISHED, channel.phase)
        assertEquals(listOf(DeliveryEvent.SECURE_CHANNEL_ESTABLISHED), channel.events())
    }

    @Test
    fun isFinalizedAfterEstablishment() {
        val channel = SecureChannelAttempt()
        channel.begin()
        channel.complete(SecureChannelOutcome.ESTABLISHED)
        assertNull(channel.complete(SecureChannelOutcome.ESTABLISHED))
        assertNull(channel.complete(SecureChannelOutcome.CLOSED))
    }

    @Test
    fun mapsEveryTlsFailurePerFixture() {
        val cases = listOf(
            SecureChannelOutcome.HANDSHAKE_FAILURE to TransportFailure(TransportErrorKind.IO_ERROR, "TLS handshake failed"),
            SecureChannelOutcome.VALIDATION_FAILURE to TransportFailure(
                TransportErrorKind.IO_ERROR,
                "certificate validation failed (trust model undefined)",
            ),
            SecureChannelOutcome.TIMEOUT to TransportFailure(TransportErrorKind.TIMEOUT, "TLS handshake timed out"),
            SecureChannelOutcome.CLOSED to TransportFailure(
                TransportErrorKind.CONNECTION_LOST,
                "connection closed during TLS handshake",
            ),
        )
        for ((outcome, expected) in cases) {
            assertEquals(expected, secureChannelFailure(outcome))
        }
    }

    @Test
    fun failingHandshakeEmitsConnectionLostOnceAndKeepsFailure() {
        for (outcome in listOf(
            SecureChannelOutcome.HANDSHAKE_FAILURE,
            SecureChannelOutcome.VALIDATION_FAILURE,
            SecureChannelOutcome.TIMEOUT,
            SecureChannelOutcome.CLOSED,
        )) {
            val channel = SecureChannelAttempt()
            channel.begin()
            assertEquals(DeliveryEvent.CONNECTION_LOST, channel.complete(outcome))
            assertEquals(SecureChannelPhase.FAILED, channel.phase)
            assertEquals(secureChannelFailure(outcome), channel.lastFailure)
            assertNull(channel.complete(outcome))
            assertEquals(listOf(DeliveryEvent.CONNECTION_LOST), channel.events())
        }
    }

    @Test
    fun abortingHandshakeEmitsConnectionLostOnceAndIsIdempotent() {
        val channel = SecureChannelAttempt()
        channel.begin()
        assertEquals(DeliveryEvent.CONNECTION_LOST, channel.close())
        assertEquals(SecureChannelPhase.CLOSED, channel.phase)
        assertNull(channel.close())
        assertEquals(listOf(DeliveryEvent.CONNECTION_LOST), channel.events())
    }

    @Test
    fun reproducesFixtureOutcomeToEventMapping() {
        val cases = listOf(
            SecureChannelOutcome.ESTABLISHED to DeliveryEvent.SECURE_CHANNEL_ESTABLISHED,
            SecureChannelOutcome.HANDSHAKE_FAILURE to DeliveryEvent.CONNECTION_LOST,
            SecureChannelOutcome.VALIDATION_FAILURE to DeliveryEvent.CONNECTION_LOST,
            SecureChannelOutcome.TIMEOUT to DeliveryEvent.CONNECTION_LOST,
            SecureChannelOutcome.CLOSED to DeliveryEvent.CONNECTION_LOST,
        )
        for ((outcome, event) in cases) {
            val channel = SecureChannelAttempt()
            channel.begin()
            assertEquals(event, channel.complete(outcome))
            assertEquals(listOf(event), channel.events())
        }
    }
}