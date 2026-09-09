package com.landrop.receiver.protocol

// Secure-channel (TLS) lifecycle foundation (protocol spec §3/§5, project
// spec §15, architecture §28/§31). TLS 1.3 is implemented by the platform
// runtime only — no custom cryptography, no invented certificate model. The
// certificate/trust policy for LanDrop peers is a SPECIFICATION GAP (protocol
// §39 defers pairing/trust); validation failure therefore surfaces the
// platform default result and is never silently weakened. This module is
// deterministic and I/O-free: it classifies platform handshake outcomes into
// transport failures and the existing DeliveryEvents.

enum class SecureChannelOutcome {
    ESTABLISHED,
    HANDSHAKE_FAILURE,
    VALIDATION_FAILURE,
    TIMEOUT,
    CLOSED,
}

val SECURE_CHANNEL_OUTCOMES: List<SecureChannelOutcome> = SecureChannelOutcome.values().toList()

enum class SecureChannelPhase { IDLE, TLS, ESTABLISHED, FAILED, CLOSED }

fun secureChannelFailure(outcome: SecureChannelOutcome): TransportFailure =
    when (outcome) {
        SecureChannelOutcome.ESTABLISHED -> error("secureChannelFailure requires a failing outcome")
        SecureChannelOutcome.HANDSHAKE_FAILURE ->
            TransportFailure(TransportErrorKind.IO_ERROR, "TLS handshake failed")
        SecureChannelOutcome.VALIDATION_FAILURE ->
            TransportFailure(
                TransportErrorKind.IO_ERROR,
                "certificate validation failed (trust model undefined)",
            )
        SecureChannelOutcome.TIMEOUT ->
            TransportFailure(TransportErrorKind.TIMEOUT, "TLS handshake timed out")
        SecureChannelOutcome.CLOSED ->
            TransportFailure(TransportErrorKind.CONNECTION_LOST, "connection closed during TLS handshake")
    }

// Deterministic TLS-handshake lifecycle over an already-open transport.
// - begin(): IDLE -> TLS. No delivery event is emitted: the delivery machine
//   stays in CONNECTING while the handshake runs.
// - complete(outcome): ESTABLISHED -> emits SECURE_CHANNEL_ESTABLISHED; any
//   failure -> emits CONNECTION_LOST once (deterministic failure propagation).
//   Repeated completion is a no-op.
// - close(): aborts a running handshake -> CONNECTION_LOST once; idempotent.
class SecureChannelAttempt {
    var phase: SecureChannelPhase = SecureChannelPhase.IDLE
        private set

    var lastFailure: TransportFailure? = null
        private set

    private val emitted = mutableListOf<DeliveryEvent>()

    fun begin() {
        if (phase == SecureChannelPhase.IDLE) phase = SecureChannelPhase.TLS
    }

    fun complete(outcome: SecureChannelOutcome): DeliveryEvent? {
        if (phase != SecureChannelPhase.TLS) return null
        if (outcome == SecureChannelOutcome.ESTABLISHED) {
            phase = SecureChannelPhase.ESTABLISHED
            emitted += DeliveryEvent.SECURE_CHANNEL_ESTABLISHED
            return DeliveryEvent.SECURE_CHANNEL_ESTABLISHED
        }
        phase = SecureChannelPhase.FAILED
        lastFailure = secureChannelFailure(outcome)
        emitted += DeliveryEvent.CONNECTION_LOST
        return DeliveryEvent.CONNECTION_LOST
    }

    fun close(): DeliveryEvent? {
        if (phase != SecureChannelPhase.TLS) return null
        phase = SecureChannelPhase.CLOSED
        emitted += DeliveryEvent.CONNECTION_LOST
        return DeliveryEvent.CONNECTION_LOST
    }

    fun events(): List<DeliveryEvent> = emitted.toList()
}