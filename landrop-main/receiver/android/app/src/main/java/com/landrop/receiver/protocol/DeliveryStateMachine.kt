package com.landrop.receiver.protocol

enum class DeliveryEvent {
    DEVICE_FOUND, CONNECT_INITIATED, SECURE_CHANNEL_ESTABLISHED, SESSION_ESTABLISHED,
    REQUEST_SENT, AWAITING_DECISION, ACCEPTED, REJECTED, TRANSFER_PREPARED,
    TRANSFER_STARTED, VERIFICATION_INITIATED, VERIFIED, INSTALL_PREPARED,
    HANDOFF_INITIATED, COMPLETED, CANCELLED, EXPIRED, TRANSFER_TIMED_OUT,
    CONNECTION_LOST, INTEGRITY_MISMATCH, INSTALLATION_UNAVAILABLE,
}

sealed class DeliveryTransition {
    data class Accepted(val to: DeliveryState) : DeliveryTransition()
    data class Rejected(
        val from: DeliveryState,
        val event: DeliveryEvent,
    ) : DeliveryTransition()
}

object DeliveryStateMachine {
    val initialDeliveryState: DeliveryState = DeliveryState.DISCOVERING

    val allDeliveryStates: List<DeliveryState> = DeliveryState.values().toList()

    val terminalStates: Set<DeliveryState> = setOf(
        DeliveryState.COMPLETED,
        DeliveryState.REJECTED,
        DeliveryState.FAILED,
        DeliveryState.CANCELLED,
    )

    fun isDeliveryTerminal(state: DeliveryState): Boolean = state in terminalStates

    fun transition(from: DeliveryState, event: DeliveryEvent): DeliveryTransition {
        val to = targetOf(from, event)
        return if (to != null) {
            DeliveryTransition.Accepted(to)
        } else {
            DeliveryTransition.Rejected(from, event)
        }
    }

    private fun targetOf(from: DeliveryState, event: DeliveryEvent): DeliveryState? = when (from) {
        DeliveryState.DISCOVERING -> when (event) {
            DeliveryEvent.DEVICE_FOUND -> DeliveryState.AVAILABLE
            else -> null
        }
        DeliveryState.AVAILABLE -> when (event) {
            DeliveryEvent.CONNECT_INITIATED -> DeliveryState.CONNECTING
            else -> null
        }
        DeliveryState.CONNECTING -> when (event) {
            DeliveryEvent.SECURE_CHANNEL_ESTABLISHED -> DeliveryState.SECURE_CHANNEL
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.SECURE_CHANNEL -> when (event) {
            DeliveryEvent.SESSION_ESTABLISHED -> DeliveryState.SESSION_ESTABLISHED
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.SESSION_ESTABLISHED -> when (event) {
            DeliveryEvent.REQUEST_SENT -> DeliveryState.REQUEST_SENT
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.REQUEST_SENT -> when (event) {
            DeliveryEvent.AWAITING_DECISION -> DeliveryState.WAITING_FOR_DECISION
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.WAITING_FOR_DECISION -> when (event) {
            DeliveryEvent.ACCEPTED -> DeliveryState.ACCEPTED
            DeliveryEvent.REJECTED -> DeliveryState.REJECTED
            DeliveryEvent.EXPIRED -> DeliveryState.FAILED
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.ACCEPTED -> when (event) {
            DeliveryEvent.TRANSFER_PREPARED -> DeliveryState.TRANSFER_PREPARING
            DeliveryEvent.CANCELLED -> DeliveryState.CANCELLED
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.TRANSFER_PREPARING -> when (event) {
            DeliveryEvent.TRANSFER_STARTED -> DeliveryState.TRANSFERRING
            DeliveryEvent.CANCELLED -> DeliveryState.CANCELLED
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.TRANSFERRING -> when (event) {
            DeliveryEvent.VERIFICATION_INITIATED -> DeliveryState.VERIFYING
            DeliveryEvent.CANCELLED -> DeliveryState.CANCELLED
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            DeliveryEvent.TRANSFER_TIMED_OUT -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.VERIFYING -> when (event) {
            DeliveryEvent.VERIFIED -> DeliveryState.VERIFIED
            DeliveryEvent.CANCELLED -> DeliveryState.CANCELLED
            DeliveryEvent.CONNECTION_LOST -> DeliveryState.FAILED
            DeliveryEvent.INTEGRITY_MISMATCH -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.VERIFIED -> when (event) {
            DeliveryEvent.INSTALL_PREPARED -> DeliveryState.INSTALL_READY
            DeliveryEvent.CANCELLED -> DeliveryState.CANCELLED
            else -> null
        }
        DeliveryState.INSTALL_READY -> when (event) {
            DeliveryEvent.HANDOFF_INITIATED -> DeliveryState.INSTALLATION_HANDOFF
            DeliveryEvent.CANCELLED -> DeliveryState.CANCELLED
            DeliveryEvent.INSTALLATION_UNAVAILABLE -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.INSTALLATION_HANDOFF -> when (event) {
            DeliveryEvent.COMPLETED -> DeliveryState.COMPLETED
            DeliveryEvent.INSTALLATION_UNAVAILABLE -> DeliveryState.FAILED
            else -> null
        }
        DeliveryState.COMPLETED, DeliveryState.REJECTED,
        DeliveryState.FAILED, DeliveryState.CANCELLED -> null
    }
}