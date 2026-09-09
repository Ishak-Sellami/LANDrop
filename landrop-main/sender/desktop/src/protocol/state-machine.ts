// Delivery state machine v1 — deterministic, pure, no I/O.
// Mirrors the Rust implementation in src-tauri/src/protocol/state_machine.rs
// and the Kotlin implementation in receiver/android/app/src/main/java/com/landrop/receiver/protocol/DeliveryStateMachine.kt.

import type { DeliveryState } from "./types";

export type DeliveryEvent =
  | "device_found"
  | "connect_initiated"
  | "secure_channel_established"
  | "session_established"
  | "request_sent"
  | "awaiting_decision"
  | "accepted"
  | "rejected"
  | "transfer_prepared"
  | "transfer_started"
  | "verification_initiated"
  | "verified"
  | "install_prepared"
  | "handoff_initiated"
  | "completed"
  | "cancelled"
  | "expired"
  | "transfer_timed_out"
  | "connection_lost"
  | "integrity_mismatch"
  | "installation_unavailable";

export const DELIVERY_EVENTS: readonly DeliveryEvent[] = [
  "device_found",
  "connect_initiated",
  "secure_channel_established",
  "session_established",
  "request_sent",
  "awaiting_decision",
  "accepted",
  "rejected",
  "transfer_prepared",
  "transfer_started",
  "verification_initiated",
  "verified",
  "install_prepared",
  "handoff_initiated",
  "completed",
  "cancelled",
  "expired",
  "transfer_timed_out",
  "connection_lost",
  "integrity_mismatch",
  "installation_unavailable",
];

export const INITIAL_DELIVERY_STATE: DeliveryState = "DISCOVERING";

export const DELIVERY_STATES: readonly DeliveryState[] = [
  "DISCOVERING",
  "AVAILABLE",
  "CONNECTING",
  "SECURE_CHANNEL",
  "SESSION_ESTABLISHED",
  "REQUEST_SENT",
  "WAITING_FOR_DECISION",
  "ACCEPTED",
  "TRANSFER_PREPARING",
  "TRANSFERRING",
  "VERIFYING",
  "VERIFIED",
  "INSTALL_READY",
  "INSTALLATION_HANDOFF",
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
];

export const DELIVERY_TERMINAL_STATES: readonly DeliveryState[] = [
  "COMPLETED",
  "REJECTED",
  "FAILED",
  "CANCELLED",
];

type TransitionRow = Readonly<Partial<Record<DeliveryEvent, DeliveryState>>>;

const TRANSITIONS: Readonly<Record<DeliveryState, TransitionRow>> = {
  DISCOVERING: { device_found: "AVAILABLE" },
  AVAILABLE: { connect_initiated: "CONNECTING" },
  CONNECTING: {
    secure_channel_established: "SECURE_CHANNEL",
    connection_lost: "FAILED",
  },
  SECURE_CHANNEL: {
    session_established: "SESSION_ESTABLISHED",
    connection_lost: "FAILED",
  },
  SESSION_ESTABLISHED: {
    request_sent: "REQUEST_SENT",
    connection_lost: "FAILED",
  },
  REQUEST_SENT: {
    awaiting_decision: "WAITING_FOR_DECISION",
    connection_lost: "FAILED",
  },
  WAITING_FOR_DECISION: {
    accepted: "ACCEPTED",
    rejected: "REJECTED",
    expired: "FAILED",
    connection_lost: "FAILED",
  },
  ACCEPTED: {
    transfer_prepared: "TRANSFER_PREPARING",
    cancelled: "CANCELLED",
    connection_lost: "FAILED",
  },
  TRANSFER_PREPARING: {
    transfer_started: "TRANSFERRING",
    cancelled: "CANCELLED",
    connection_lost: "FAILED",
  },
  TRANSFERRING: {
    verification_initiated: "VERIFYING",
    cancelled: "CANCELLED",
    connection_lost: "FAILED",
    transfer_timed_out: "FAILED",
  },
  VERIFYING: {
    verified: "VERIFIED",
    cancelled: "CANCELLED",
    connection_lost: "FAILED",
    integrity_mismatch: "FAILED",
  },
  VERIFIED: {
    install_prepared: "INSTALL_READY",
    cancelled: "CANCELLED",
  },
  INSTALL_READY: {
    handoff_initiated: "INSTALLATION_HANDOFF",
    cancelled: "CANCELLED",
    installation_unavailable: "FAILED",
  },
  INSTALLATION_HANDOFF: {
    completed: "COMPLETED",
    installation_unavailable: "FAILED",
  },
  COMPLETED: {},
  REJECTED: {},
  FAILED: {},
  CANCELLED: {},
};

export interface InvalidTransition {
  readonly ok: false;
  readonly reason: "INVALID_TRANSITION";
  readonly from: DeliveryState;
  readonly event: DeliveryEvent;
}

export type DeliveryTransition =
  | { readonly ok: true; readonly to: DeliveryState }
  | InvalidTransition;

export function transition(
  from: DeliveryState,
  event: DeliveryEvent,
): DeliveryTransition {
  const row = TRANSITIONS[from];
  const target = row[event];
  if (target === undefined) {
    return { ok: false, reason: "INVALID_TRANSITION", from, event };
  }
  return { ok: true, to: target };
}

export function isDeliveryTerminal(state: DeliveryState): boolean {
  return DELIVERY_TERMINAL_STATES.includes(state);
}