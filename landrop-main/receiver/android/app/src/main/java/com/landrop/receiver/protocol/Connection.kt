package com.landrop.receiver.protocol

// Connection lifecycle foundation (protocol spec §5, project spec §15,
// architecture §28/§29/§31). ONE deterministic connection attempt per
// lifecycle; no automatic reconnection, pooling, load balancing, NAT
// traversal, or proxying. The platform seam maps socket outcomes into
// ConnectionOutcome; this module maps them into TransportFailure and the
// existing DeliveryEvents. Networking layers only ever emit the events the
// delivery state machine already defines.

enum class ConnectionOutcome { ESTABLISHED, REFUSED, TIMEOUT, CLOSED, IO_ERROR }

val CONNECTION_OUTCOMES: List<ConnectionOutcome> = ConnectionOutcome.values().toList()

enum class ConnectionPhase { IDLE, CONNECTING, ESTABLISHED, FAILED, CLOSED }

// Fixture-driven failure mapping (protocol spec §27 CONNECTION_LOST,
// architecture §31 transport errors). No new wire ErrorCodes.
fun connectionFailure(outcome: ConnectionOutcome): TransportFailure =
    when (outcome) {
        ConnectionOutcome.ESTABLISHED -> error("connectionFailure requires a failing outcome")
        ConnectionOutcome.REFUSED -> TransportFailure(TransportErrorKind.IO_ERROR, "connection refused")
        ConnectionOutcome.TIMEOUT -> TransportFailure(TransportErrorKind.TIMEOUT, "connection timed out")
        ConnectionOutcome.CLOSED -> TransportFailure(TransportErrorKind.CONNECTION_LOST, "connection closed")
        ConnectionOutcome.IO_ERROR -> TransportFailure(TransportErrorKind.IO_ERROR, "transport I/O error")
    }

// Deterministic single-attempt connection lifecycle.
// - begin(): IDLE -> CONNECTING, emits CONNECT_INITIATED.
// - complete(outcome): CONNECTING -> ESTABLISHED (no delivery event) or ->
//   FAILED (emits CONNECTION_LOST once). Completed attempts are finalized:
//   repeated complete() is a no-op.
// - close(): CONNECTING|ESTABLISHED -> CLOSED, emits CONNECTION_LOST once;
//   idempotent from any terminal phase (architecture §31, fixture close case).
class ConnectionAttempt {
    var phase: ConnectionPhase = ConnectionPhase.IDLE
        private set

    var lastFailure: TransportFailure? = null
        private set

    private val emitted = mutableListOf<DeliveryEvent>()

    fun begin(): DeliveryEvent? {
        if (phase != ConnectionPhase.IDLE) return null
        phase = ConnectionPhase.CONNECTING
        emitted += DeliveryEvent.CONNECT_INITIATED
        return DeliveryEvent.CONNECT_INITIATED
    }

    fun complete(outcome: ConnectionOutcome): DeliveryEvent? {
        if (phase != ConnectionPhase.CONNECTING) return null
        if (outcome == ConnectionOutcome.ESTABLISHED) {
            phase = ConnectionPhase.ESTABLISHED
            return null
        }
        phase = ConnectionPhase.FAILED
        lastFailure = connectionFailure(outcome)
        emitted += DeliveryEvent.CONNECTION_LOST
        return DeliveryEvent.CONNECTION_LOST
    }

    fun close(): DeliveryEvent? {
        if (phase != ConnectionPhase.CONNECTING && phase != ConnectionPhase.ESTABLISHED) return null
        phase = ConnectionPhase.CLOSED
        emitted += DeliveryEvent.CONNECTION_LOST
        return DeliveryEvent.CONNECTION_LOST
    }

    fun events(): List<DeliveryEvent> = emitted.toList()
}