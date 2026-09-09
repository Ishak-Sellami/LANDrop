import { describe, expect, it } from "vitest";
import type { DeliveryState } from "./types";
import {
  DELIVERY_EVENTS,
  DELIVERY_STATES,
  DELIVERY_TERMINAL_STATES,
  INITIAL_DELIVERY_STATE,
  isDeliveryTerminal,
  transition,
} from "./state-machine";
import type { DeliveryEvent } from "./state-machine";

// ---------------------------------------------------------------------------
// Shared fixture — the machine table is the cross-stack source of truth.
// ---------------------------------------------------------------------------

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

interface TransitionSpec {
  readonly from: DeliveryState;
  readonly event: DeliveryEvent;
  readonly to: DeliveryState;
}

const machine = fixtures.delivery_state_machine as {
  readonly initial_state: DeliveryState;
  readonly terminal_states: readonly DeliveryState[];
  readonly events: readonly DeliveryEvent[];
  readonly transitions: readonly TransitionSpec[];
};

// ---------------------------------------------------------------------------
// Fixture parity — the TS table must be identical to the shared fixture.
// ---------------------------------------------------------------------------

describe("Delivery state machine — fixture parity", () => {
  it("exposes the spec-defined 18 states in order", () => {
    expect(DELIVERY_STATES).toEqual(fixtures.delivery_states);
    expect(DELIVERY_STATES.length).toBe(18);
  });

  it("declares the initial state from the fixture", () => {
    expect(INITIAL_DELIVERY_STATE).toBe(machine.initial_state);
    expect(INITIAL_DELIVERY_STATE).toBe("DISCOVERING");
  });

  it("declares the same terminal states as the fixture", () => {
    expect([...DELIVERY_TERMINAL_STATES].sort()).toEqual(
      [...machine.terminal_states].sort(),
    );
  });

  it("declares the same event vocabulary as the fixture", () => {
    expect([...DELIVERY_EVENTS].sort()).toEqual([...machine.events].sort());
    expect(new Set(DELIVERY_EVENTS).size).toBe(DELIVERY_EVENTS.length);
  });

  it("agrees with the fixture on every declared transition", () => {
    for (const spec of machine.transitions) {
      const result = transition(spec.from, spec.event);
      expect(result, `${spec.from} + ${spec.event}`).toEqual({
        ok: true,
        to: spec.to,
      });
    }
  });

  it("rejects every (state, event) pair the fixture does not declare", () => {
    const declared = new Set(
      machine.transitions.map((t) => `${t.from}|${t.event}`),
    );
    for (const state of DELIVERY_STATES) {
      for (const event of DELIVERY_EVENTS) {
        const result = transition(state, event);
        if (declared.has(`${state}|${event}`)) {
          expect(result.ok).toBe(true);
        } else {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.reason).toBe("INVALID_TRANSITION");
            expect(result.from).toBe(state);
            expect(result.event).toBe(event);
          }
        }
      }
    }
  });

  it("declares no (state, event) pair outside the fixture event vocabulary", () => {
    const fixtureEvents = new Set(machine.events);
    for (const spec of machine.transitions) {
      expect(fixtureEvents.has(spec.event), spec.event).toBe(true);
    }
  });

  it("declares no transition from the initial state using a non-progress event", () => {
    const row = machine.transitions.filter(
      (t) => t.from === machine.initial_state,
    );
    expect(row).toEqual([
      { from: "DISCOVERING", event: "device_found", to: "AVAILABLE" },
    ]);
  });

  it("declares no event that is never used", () => {
    const used = new Set(machine.transitions.map((t) => t.event));
    for (const event of machine.events) {
      expect(used.has(event), event).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Machine invariants.
// ---------------------------------------------------------------------------

describe("Delivery state machine — invariants", () => {
  it("has no duplicate rows in the fixture", () => {
    const seen = new Set<string>();
    for (const spec of machine.transitions) {
      const key = `${spec.from}|${spec.event}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("rejects atomically: a failed transition changes nothing", () => {
    const result = transition(INITIAL_DELIVERY_STATE, "cancelled");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.from).toBe(INITIAL_DELIVERY_STATE);
      expect(result.event).toBe("cancelled");
    }
  });

  it("is deterministic", () => {
    for (const state of DELIVERY_STATES) {
      for (const event of DELIVERY_EVENTS) {
        const first = transition(state, event);
        const second = transition(state, event);
        expect(second).toEqual(first);
      }
    }
  });

  it("accepts no event from a terminal state", () => {
    for (const state of DELIVERY_TERMINAL_STATES) {
      expect(isDeliveryTerminal(state)).toBe(true);
      for (const event of DELIVERY_EVENTS) {
        expect(transition(state, event).ok, `${state} + ${event}`).toBe(false);
      }
    }
  });

  it("only names fixture terminal states as terminal", () => {
    for (const state of DELIVERY_STATES) {
      const fixtureTerminal = machine.terminal_states.includes(state);
      expect(isDeliveryTerminal(state), state).toBe(fixtureTerminal);
    }
  });

  it("keeps every non-terminal state capable of progress or exit", () => {
    for (const state of DELIVERY_STATES) {
      if (isDeliveryTerminal(state)) continue;
      const row = machine.transitions.filter((t) => t.from === state);
      expect(row.length, state).toBeGreaterThan(0);
    }
  });

  it("reaches every state from the initial state via valid transitions", () => {
    const reachable = new Set<DeliveryState>([INITIAL_DELIVERY_STATE]);
    let frontier = [INITIAL_DELIVERY_STATE];
    while (frontier.length > 0) {
      const next: DeliveryState[] = [];
      for (const state of frontier) {
        for (const spec of machine.transitions) {
          if (spec.from === state && !reachable.has(spec.to)) {
            reachable.add(spec.to);
            next.push(spec.to);
          }
        }
      }
      frontier = next;
    }
    expect(reachable.size).toBe(18);
    expect([...reachable].sort()).toEqual([...DELIVERY_STATES].sort());
  });

  it("only accepts events that stay within the 18-state model", () => {
    const validStates = new Set(DELIVERY_STATES);
    for (const spec of machine.transitions) {
      expect(validStates.has(spec.from), spec.from).toBe(true);
      expect(validStates.has(spec.to), spec.to).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Behavior — happy path, documented alternatives, and specific rejections.
// ---------------------------------------------------------------------------

describe("Delivery state machine — behavior", () => {
  it("completes the full delivery chain from DISCOVERING to COMPLETED", () => {
    const path: [DeliveryState, DeliveryEvent][] = [
      ["DISCOVERING", "device_found"],
      ["AVAILABLE", "connect_initiated"],
      ["CONNECTING", "secure_channel_established"],
      ["SECURE_CHANNEL", "session_established"],
      ["SESSION_ESTABLISHED", "request_sent"],
      ["REQUEST_SENT", "awaiting_decision"],
      ["WAITING_FOR_DECISION", "accepted"],
      ["ACCEPTED", "transfer_prepared"],
      ["TRANSFER_PREPARING", "transfer_started"],
      ["TRANSFERRING", "verification_initiated"],
      ["VERIFYING", "verified"],
      ["VERIFIED", "install_prepared"],
      ["INSTALL_READY", "handoff_initiated"],
      ["INSTALLATION_HANDOFF", "completed"],
    ];
    let state: DeliveryState = INITIAL_DELIVERY_STATE;
    for (const [from, event] of path) {
      const result = transition(from, event);
      expect(result.ok, `${from} + ${event}`).toBe(true);
      if (result.ok) state = result.to;
    }
    expect(state).toBe("COMPLETED");
  });

  it("routes a user rejection to REJECTED", () => {
    const result = transition("WAITING_FOR_DECISION", "rejected");
    expect(result).toEqual({ ok: true, to: "REJECTED" });
  });

  it("routes the documented failure conditions to FAILED", () => {
    expect(transition("WAITING_FOR_DECISION", "expired")).toEqual({
      ok: true,
      to: "FAILED",
    });
    expect(transition("TRANSFERRING", "transfer_timed_out")).toEqual({
      ok: true,
      to: "FAILED",
    });
    expect(transition("VERIFYING", "integrity_mismatch")).toEqual({
      ok: true,
      to: "FAILED",
    });
    expect(transition("CONNECTING", "connection_lost")).toEqual({
      ok: true,
      to: "FAILED",
    });
  });

  it("routes cancellation to CANCELLED while a transfer is active", () => {
    for (const state of [
      "ACCEPTED",
      "TRANSFER_PREPARING",
      "TRANSFERRING",
      "VERIFYING",
      "VERIFIED",
      "INSTALL_READY",
    ] as const) {
      expect(transition(state, "cancelled"), state).toEqual({
        ok: true,
        to: "CANCELLED",
      });
    }
  });

  it("covers the exhaustive matrix exactly once per declared edge", () => {
    const declared = new Map<string, DeliveryState>();
    for (const spec of machine.transitions) {
      const key = `${spec.from}|${spec.event}`;
      expect(declared.has(key), key).toBe(false);
      declared.set(key, spec.to);
    }
    const states = DELIVERY_STATES.length;
    const events = DELIVERY_EVENTS.length;
    let checked = 0;
    for (const state of DELIVERY_STATES) {
      for (const event of DELIVERY_EVENTS) {
        const key = `${state}|${event}`;
        const result = transition(state, event);
        if (declared.has(key)) {
          expect(result, key).toEqual({ ok: true, to: declared.get(key) });
        } else {
          expect(result.ok, key).toBe(false);
        }
        checked++;
      }
    }
    expect(checked).toBe(states * events);
  });

  it("rejects out-of-scope actions before a session exists", () => {
    expect(transition("DISCOVERING", "accepted")).toEqual({
      ok: false,
      reason: "INVALID_TRANSITION",
      from: "DISCOVERING",
      event: "accepted",
    });
  });

  it("rejects accepting before the request is presented", () => {
    expect(transition("REQUEST_SENT", "accepted").ok).toBe(false);
  });

  it("rejects proceeding to install before verification", () => {
    expect(transition("TRANSFERRING", "install_prepared").ok).toBe(false);
  });
});