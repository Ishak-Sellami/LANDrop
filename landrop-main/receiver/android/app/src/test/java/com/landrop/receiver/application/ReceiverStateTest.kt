package com.landrop.receiver.application

import org.junit.Assert.assertEquals
import org.junit.Test

class ReceiverStateTest {
    @Test
    fun startsWithoutASenderConnection() {
        assertEquals(ConnectionStatus.NOT_CONNECTED, ReceiverState().connection)
    }
}
