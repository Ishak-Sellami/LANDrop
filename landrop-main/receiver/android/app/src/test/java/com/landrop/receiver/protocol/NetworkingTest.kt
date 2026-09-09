package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NetworkingTest {

    private val discoveryInfo = DiscoveryInfo(
        service = DISCOVERY_SERVICE_TYPE,
        hostname = "receiver-device.local",
        port = 45821,
        protocolVersion = 1,
        deviceName = "Android Device",
    )

    @Test
    fun networkingFlowReachesSessionEstablished() {
        // discovery (protocol §4)
        val registry = DiscoveryRegistry()
        registry.upsert(discoveryInfo)
        assertEquals(1, registry.size)
        assertTrue(isDiscoverySupportedVersion(discoveryInfo))

        // connection (protocol §5 steps 1-2)
        val connection = ConnectionAttempt()
        assertEquals(DeliveryEvent.CONNECT_INITIATED, connection.begin())
        assertEquals(null, connection.complete(ConnectionOutcome.ESTABLISHED))

        // TLS 1.3 on the open transport (steps 3-4)
        val channel = SecureChannelAttempt()
        channel.begin()
        assertEquals(DeliveryEvent.SECURE_CHANNEL_ESTABLISHED, channel.complete(SecureChannelOutcome.ESTABLISHED))

        // negotiation (step 5) + session establishment (steps 6-7)
        assertTrue(supportsProtocolVersion(1))
        val est = establishSession(
            SessionDraft(
                sessionId = "sess_01JTEST",
                protocolVersion = 1,
                sender = SenderProfile("ISHAQ CYBERTECH"),
                receiver = DeviceInfo("Test Device"),
                lifetime = Lifetime(0, 1000),
            ),
            EstablishmentPrerequisites(transportEstablished = true, secureChannelEstablished = true),
        ) as SessionEstablishmentResult.Ok
        assertEquals(DeliveryState.DISCOVERING, est.session.state)
        assertEquals(DeliveryEvent.SESSION_ESTABLISHED, sessionEstablishedEvent())

        // delivery machine mapping (protocol §5 steps 1-7)
        var state = DeliveryStateMachine.initialDeliveryState
        val steps = listOf(
            DeliveryEvent.DEVICE_FOUND to DeliveryState.AVAILABLE,
            DeliveryEvent.CONNECT_INITIATED to DeliveryState.CONNECTING,
            DeliveryEvent.SECURE_CHANNEL_ESTABLISHED to DeliveryState.SECURE_CHANNEL,
            DeliveryEvent.SESSION_ESTABLISHED to DeliveryState.SESSION_ESTABLISHED,
        )
        for ((event, expected) in steps) {
            assertEquals(expected, (DeliveryStateMachine.transition(state, event) as DeliveryTransition.Accepted).to)
            state = expected
        }
        assertEquals(DeliveryState.SESSION_ESTABLISHED, state)
    }

    @Test
    fun refusedConnectionFlowIsConnectionLost() {
        val connection = ConnectionAttempt()
        connection.begin()
        assertEquals(DeliveryEvent.CONNECTION_LOST, connection.complete(ConnectionOutcome.REFUSED))
        assertEquals(ConnectionPhase.FAILED, connection.phase)
        assertEquals(
            listOf(DeliveryEvent.CONNECT_INITIATED, DeliveryEvent.CONNECTION_LOST),
            connection.events(),
        )
        assertEquals(
            DeliveryState.FAILED,
            (DeliveryStateMachine.transition(DeliveryState.CONNECTING, DeliveryEvent.CONNECTION_LOST) as DeliveryTransition.Accepted).to,
        )
    }

    @Test
    fun connectionLostDrivesReachedStagesToFailed() {
        for (state in listOf(
            DeliveryState.CONNECTING,
            DeliveryState.SECURE_CHANNEL,
            DeliveryState.SESSION_ESTABLISHED,
        )) {
            assertEquals(
                DeliveryState.FAILED,
                (DeliveryStateMachine.transition(state, DeliveryEvent.CONNECTION_LOST) as DeliveryTransition.Accepted).to,
            )
        }
        assertTrue(DeliveryStateMachine.isDeliveryTerminal(DeliveryState.FAILED))
        assertTrue(
            DeliveryStateMachine.transition(DeliveryState.FAILED, DeliveryEvent.CONNECTION_LOST)
                is DeliveryTransition.Rejected,
        )
    }

    @Test
    fun networkingLayersMapOnlyIntoDefinedDeliveryEvents() {
        val emitted = listOf(
            DeliveryEvent.DEVICE_FOUND,
            DeliveryEvent.CONNECT_INITIATED,
            DeliveryEvent.SECURE_CHANNEL_ESTABLISHED,
            DeliveryEvent.SESSION_ESTABLISHED,
            DeliveryEvent.CONNECTION_LOST,
        )
        val defined = DeliveryEvent.values().toList()
        assertTrue(defined.containsAll(emitted))
    }
}