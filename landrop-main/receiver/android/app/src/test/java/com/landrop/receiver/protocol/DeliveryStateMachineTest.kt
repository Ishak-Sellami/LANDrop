package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class DeliveryStateMachineTest {

    private val allStates: List<DeliveryState> = DeliveryState.values().toList()
    private val allEvents: List<DeliveryEvent> = DeliveryEvent.values().toList()

    private fun expected(target: DeliveryState, from: DeliveryState, event: DeliveryEvent) =
        Triple(from, event, target)

    private val expectedTable: List<Triple<DeliveryState, DeliveryEvent, DeliveryState>> = listOf(
        expected(DeliveryState.AVAILABLE, DeliveryState.DISCOVERING, DeliveryEvent.DEVICE_FOUND),
        expected(DeliveryState.CONNECTING, DeliveryState.AVAILABLE, DeliveryEvent.CONNECT_INITIATED),
        expected(DeliveryState.SECURE_CHANNEL, DeliveryState.CONNECTING, DeliveryEvent.SECURE_CHANNEL_ESTABLISHED),
        expected(DeliveryState.FAILED, DeliveryState.CONNECTING, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.SESSION_ESTABLISHED, DeliveryState.SECURE_CHANNEL, DeliveryEvent.SESSION_ESTABLISHED),
        expected(DeliveryState.FAILED, DeliveryState.SECURE_CHANNEL, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.REQUEST_SENT, DeliveryState.SESSION_ESTABLISHED, DeliveryEvent.REQUEST_SENT),
        expected(DeliveryState.FAILED, DeliveryState.SESSION_ESTABLISHED, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.WAITING_FOR_DECISION, DeliveryState.REQUEST_SENT, DeliveryEvent.AWAITING_DECISION),
        expected(DeliveryState.FAILED, DeliveryState.REQUEST_SENT, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.ACCEPTED, DeliveryState.WAITING_FOR_DECISION, DeliveryEvent.ACCEPTED),
        expected(DeliveryState.REJECTED, DeliveryState.WAITING_FOR_DECISION, DeliveryEvent.REJECTED),
        expected(DeliveryState.FAILED, DeliveryState.WAITING_FOR_DECISION, DeliveryEvent.EXPIRED),
        expected(DeliveryState.FAILED, DeliveryState.WAITING_FOR_DECISION, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.TRANSFER_PREPARING, DeliveryState.ACCEPTED, DeliveryEvent.TRANSFER_PREPARED),
        expected(DeliveryState.CANCELLED, DeliveryState.ACCEPTED, DeliveryEvent.CANCELLED),
        expected(DeliveryState.FAILED, DeliveryState.ACCEPTED, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.TRANSFERRING, DeliveryState.TRANSFER_PREPARING, DeliveryEvent.TRANSFER_STARTED),
        expected(DeliveryState.CANCELLED, DeliveryState.TRANSFER_PREPARING, DeliveryEvent.CANCELLED),
        expected(DeliveryState.FAILED, DeliveryState.TRANSFER_PREPARING, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.VERIFYING, DeliveryState.TRANSFERRING, DeliveryEvent.VERIFICATION_INITIATED),
        expected(DeliveryState.CANCELLED, DeliveryState.TRANSFERRING, DeliveryEvent.CANCELLED),
        expected(DeliveryState.FAILED, DeliveryState.TRANSFERRING, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.FAILED, DeliveryState.TRANSFERRING, DeliveryEvent.TRANSFER_TIMED_OUT),
        expected(DeliveryState.VERIFIED, DeliveryState.VERIFYING, DeliveryEvent.VERIFIED),
        expected(DeliveryState.CANCELLED, DeliveryState.VERIFYING, DeliveryEvent.CANCELLED),
        expected(DeliveryState.FAILED, DeliveryState.VERIFYING, DeliveryEvent.CONNECTION_LOST),
        expected(DeliveryState.FAILED, DeliveryState.VERIFYING, DeliveryEvent.INTEGRITY_MISMATCH),
        expected(DeliveryState.INSTALL_READY, DeliveryState.VERIFIED, DeliveryEvent.INSTALL_PREPARED),
        expected(DeliveryState.CANCELLED, DeliveryState.VERIFIED, DeliveryEvent.CANCELLED),
        expected(DeliveryState.INSTALLATION_HANDOFF, DeliveryState.INSTALL_READY, DeliveryEvent.HANDOFF_INITIATED),
        expected(DeliveryState.CANCELLED, DeliveryState.INSTALL_READY, DeliveryEvent.CANCELLED),
        expected(DeliveryState.FAILED, DeliveryState.INSTALL_READY, DeliveryEvent.INSTALLATION_UNAVAILABLE),
        expected(DeliveryState.COMPLETED, DeliveryState.INSTALLATION_HANDOFF, DeliveryEvent.COMPLETED),
        expected(DeliveryState.FAILED, DeliveryState.INSTALLATION_HANDOFF, DeliveryEvent.INSTALLATION_UNAVAILABLE),
    )

    @Test
    fun startsInDiscovering() {
        assertEquals(DeliveryState.DISCOVERING, DeliveryStateMachine.initialDeliveryState)
    }

    @Test
    fun completesTheFullDeliveryChain() {
        val path = listOf(
            DeliveryState.DISCOVERING to DeliveryEvent.DEVICE_FOUND,
            DeliveryState.AVAILABLE to DeliveryEvent.CONNECT_INITIATED,
            DeliveryState.CONNECTING to DeliveryEvent.SECURE_CHANNEL_ESTABLISHED,
            DeliveryState.SECURE_CHANNEL to DeliveryEvent.SESSION_ESTABLISHED,
            DeliveryState.SESSION_ESTABLISHED to DeliveryEvent.REQUEST_SENT,
            DeliveryState.REQUEST_SENT to DeliveryEvent.AWAITING_DECISION,
            DeliveryState.WAITING_FOR_DECISION to DeliveryEvent.ACCEPTED,
            DeliveryState.ACCEPTED to DeliveryEvent.TRANSFER_PREPARED,
            DeliveryState.TRANSFER_PREPARING to DeliveryEvent.TRANSFER_STARTED,
            DeliveryState.TRANSFERRING to DeliveryEvent.VERIFICATION_INITIATED,
            DeliveryState.VERIFYING to DeliveryEvent.VERIFIED,
            DeliveryState.VERIFIED to DeliveryEvent.INSTALL_PREPARED,
            DeliveryState.INSTALL_READY to DeliveryEvent.HANDOFF_INITIATED,
            DeliveryState.INSTALLATION_HANDOFF to DeliveryEvent.COMPLETED,
        )
        var state = DeliveryStateMachine.initialDeliveryState
        for ((from, event) in path) {
            assertEquals(from, state)
            state = (DeliveryStateMachine.transition(state, event) as DeliveryTransition.Accepted).to
        }
        assertEquals(DeliveryState.COMPLETED, state)
    }

    @Test
    fun routesRejectionToRejected() {
        val result = DeliveryStateMachine.transition(
            DeliveryState.WAITING_FOR_DECISION,
            DeliveryEvent.REJECTED,
        )
        assertEquals(DeliveryState.REJECTED, (result as DeliveryTransition.Accepted).to)
    }

    @Test
    fun routesDocumentedFailuresToFailed() {
        val failures = listOf(
            DeliveryState.WAITING_FOR_DECISION to DeliveryEvent.EXPIRED,
            DeliveryState.TRANSFERRING to DeliveryEvent.TRANSFER_TIMED_OUT,
            DeliveryState.VERIFYING to DeliveryEvent.INTEGRITY_MISMATCH,
            DeliveryState.CONNECTING to DeliveryEvent.CONNECTION_LOST,
        )
        for ((from, event) in failures) {
            val result = DeliveryStateMachine.transition(from, event)
            assertEquals(DeliveryState.FAILED, (result as DeliveryTransition.Accepted).to)
        }
    }

    @Test
    fun routesCancellationToCancelledWhileTransferIsActive() {
        val cancellable = listOf(
            DeliveryState.ACCEPTED,
            DeliveryState.TRANSFER_PREPARING,
            DeliveryState.TRANSFERRING,
            DeliveryState.VERIFYING,
            DeliveryState.VERIFIED,
            DeliveryState.INSTALL_READY,
        )
        for (from in cancellable) {
            val result = DeliveryStateMachine.transition(from, DeliveryEvent.CANCELLED)
            assertEquals(DeliveryState.CANCELLED, (result as DeliveryTransition.Accepted).to)
        }
    }

    @Test
    fun terminalStatesRejectEveryEvent() {
        for (state in DeliveryStateMachine.terminalStates) {
            assertTrue(DeliveryStateMachine.isDeliveryTerminal(state))
            for (event in allEvents) {
                assertTrue(
                    "expected rejection $state + $event",
                    DeliveryStateMachine.transition(state, event) is DeliveryTransition.Rejected,
                )
            }
        }
    }

    @Test
    fun everyNonTerminalStateAcceptsAtLeastOneEvent() {
        for (state in allStates) {
            if (DeliveryStateMachine.isDeliveryTerminal(state)) continue
            val accepts = allEvents.any {
                DeliveryStateMachine.transition(state, it) is DeliveryTransition.Accepted
            }
            assertTrue("no outgoing edge from $state", accepts)
        }
    }

    @Test
    fun exhaustiveMatrixMatchesExpectedTable() {
        val expected = expectedTable.map { (from, event, to) -> (from to event) to to }.toMap()
        assertEquals(expectedTable.size, expected.size)
        var checked = 0
        for (state in allStates) {
            for (event in allEvents) {
                val result = DeliveryStateMachine.transition(state, event)
                val declared: DeliveryState? = expected[state to event]
                if (declared != null) {
                    assertEquals(
                        "unexpected target for $state + $event",
                        DeliveryTransition.Accepted(declared),
                        result,
                    )
                } else {
                    assertTrue(
                        "expected rejection for $state + $event",
                        result is DeliveryTransition.Rejected,
                    )
                }
                checked++
            }
        }
        assertEquals(allStates.size * allEvents.size, checked)
    }

    @Test
    fun isDeterministic() {
        for (state in allStates) {
            for (event in allEvents) {
                assertEquals(
                    DeliveryStateMachine.transition(state, event),
                    DeliveryStateMachine.transition(state, event),
                )
            }
        }
    }

    @Test
    fun rejectedTransitionPreservesSourceStateAndEvent() {
        val result = DeliveryStateMachine.transition(
            DeliveryState.DISCOVERING,
            DeliveryEvent.CANCELLED,
        )
        assertEquals(
            DeliveryTransition.Rejected(DeliveryState.DISCOVERING, DeliveryEvent.CANCELLED),
            result,
        )
    }

    @Test
    fun everyStateIsReachableFromInitial() {
        val reachable = mutableSetOf(DeliveryStateMachine.initialDeliveryState)
        val frontier = ArrayDeque(listOf(DeliveryStateMachine.initialDeliveryState))
        while (frontier.isNotEmpty()) {
            val state = frontier.removeFirst()
            for (event in allEvents) {
                val result = DeliveryStateMachine.transition(state, event)
                if (result is DeliveryTransition.Accepted && reachable.add(result.to)) {
                    frontier.addLast(result.to)
                }
            }
        }
        assertEquals("unreachable states", allStates.toSet(), reachable)
    }
}