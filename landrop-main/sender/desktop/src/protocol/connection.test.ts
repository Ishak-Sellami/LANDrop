import { describe, expect, it } from "vitest";

import {
  ConnectionAttempt,
  CONNECTION_BEGIN_EVENT,
  CONNECTION_LOST_EVENT,
  CONNECTION_OUTCOMES,
  connectionFailure,
} from "./connection";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const connection = fixtures.connection as {
  endpoint: { hostname: string; port: number };
  outcomes: string[];
  failure_mapping: { outcome: string; transport_kind: string; message: string }[];
  cases: { name: string; outcome_events: string[] }[];
};

describe("phase 05 — connection lifecycle foundation", () => {
  it("matches the fixture outcome vocabulary", () => {
    expect(CONNECTION_OUTCOMES).toEqual(
      ["established", "refused", "timeout", "closed", "io_error"],
    );
    expect(connection.outcomes).toEqual(CONNECTION_OUTCOMES);
  });

  it("begin() emits connect_initiated exactly once and enters connecting", () => {
    const attempt = new ConnectionAttempt();
    expect(attempt.begin()).toBe("connect_initiated");
    expect(attempt.currentPhase).toBe("connecting");
    expect(attempt.begin()).toBeNull();
    expect(attempt.events().events).toEqual([CONNECTION_BEGIN_EVENT]);
  });

  it("establishes without emitting a delivery event (TLS follows)", () => {
    const attempt = new ConnectionAttempt();
    attempt.begin();
    expect(attempt.complete("established")).toBeNull();
    expect(attempt.currentPhase).toBe("established");
    expect(attempt.lastFailure).toBeNull();
  });

  it("maps every connection failure to a transport failure per the fixture", () => {
    for (const row of connection.failure_mapping) {
      const outcome = row.outcome;
      expect(CONNECTION_OUTCOMES).toContain(outcome);
      const failure = connectionFailure(outcome as "refused" | "timeout" | "closed" | "io_error");
      expect(failure, row.outcome).toEqual({ kind: row.transport_kind, message: row.message });
    }
  });

  it("failing an attempt emits connection_lost once and keeps the failure", () => {
    for (const outcome of ["refused", "timeout", "closed", "io_error"] as const) {
      const attempt = new ConnectionAttempt();
      attempt.begin();
      const event = attempt.complete(outcome);
      expect(event).toBe("connection_lost");
      expect(attempt.currentPhase).toBe("failed");
      expect(attempt.lastFailure).toEqual(connectionFailure(outcome));
      expect(attempt.complete(outcome)).toBeNull();
      expect(attempt.events().events).toEqual([CONNECTION_BEGIN_EVENT, CONNECTION_LOST_EVENT]);
    }
  });

  it("an established connection is finalized: repeated completion is a no-op", () => {
    const attempt = new ConnectionAttempt();
    attempt.begin();
    attempt.complete("established");
    expect(attempt.complete("established")).toBeNull();
    expect(attempt.complete("refused")).toBeNull();
    expect(attempt.currentPhase).toBe("established");
  });

  it("close() is deterministic and idempotent from any phase", () => {
    for (const startPhase of ["connecting", "established"] as const) {
      const attempt = new ConnectionAttempt();
      attempt.begin();
      if (startPhase === "established") attempt.complete("established");
      expect(attempt.close()).toBe("connection_lost");
      expect(attempt.currentPhase).toBe("closed");
      expect(attempt.close()).toBeNull();
    }
    const failed = new ConnectionAttempt();
    failed.begin();
    failed.complete("timeout");
    expect(failed.close()).toBeNull();
  });

  it("reproduces the fixture connection cases deterministically", () => {
    for (const ctx of connection.cases) {
      const attempt = new ConnectionAttempt();
      attempt.begin();
      if (ctx.name === "established_then_lost") {
        attempt.complete("established");
        attempt.close();
      } else {
        attempt.complete(ctx.name as "refused" | "timeout" | "io_error");
      }
      expect(attempt.events().events, ctx.name).toEqual(ctx.outcome_events);
      const replay = new ConnectionAttempt();
      replay.begin();
      if (ctx.name === "established_then_lost") {
        replay.complete("established");
        replay.close();
      } else {
        replay.complete(ctx.name as "refused" | "timeout" | "io_error");
      }
      expect(replay.events().events, `${ctx.name} replay`).toEqual(ctx.outcome_events);
    }
  });
});