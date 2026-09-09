package com.landrop.receiver.application

// Foundation state only; this is not the delivery/session state machine.
data class ReceiverState(
    val connection: ConnectionStatus = ConnectionStatus.NOT_CONNECTED,
)

enum class ConnectionStatus {
    NOT_CONNECTED,
}
