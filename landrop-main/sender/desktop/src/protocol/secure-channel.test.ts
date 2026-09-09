import { describe, expect, it } from "vitest";

import {
  SECURE_CHANNEL_ESTABLISHED_EVENT,
  CONNECTION_LOST_EVENT,
  SECURE_CHANNEL_OUTCOMES,
  SecureChannelAttempt,
  secureChannelFailure,
} from "./secure-channel";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const secureChannel = fixtures.secure_channel as {
  outcomes: string[];
  failure_mapping: { outcome: string; transport_kind: string; message: string }[];
  event_mapping: { outcome: string; event: string }[];
};

describe("phase 05 — secure channel lifecycle foundation", () => {
  it("matches the fixture outcome vocabulary", () => {
    expect(SECURE_CHANNEL_OUTCOMES).toEqual(
      ["established", "handshake_failure", "validation_failure", "timeout", "closed"],
    );
    expect(secureChannel.outcomes).toEqual(SECURE_CHANNEL_OUTCOMES);
  });

  it("handshake phase emits no delivery event (machine stays CONNECTING)", () => {
    const channel = new SecureChannelAttempt();
    expect(channel.begin()).toBeNull();
    expect(channel.currentPhase).toBe("tls");
  });

  it("establishes the secure channel and emits secure_channel_established", () => {
    const channel = new SecureChannelAttempt();
    channel.begin();
    expect(channel.complete("established")).toBe("secure_channel_established");
    expect(channel.currentPhase).toBe("established");
    expect(channel.events()).toEqual([SECURE_CHANNEL_ESTABLISHED_EVENT]);
  });

  it("is finalized after establishment: repeated completion is a no-op", () => {
    const channel = new SecureChannelAttempt();
    channel.begin();
    channel.complete("established");
    expect(channel.complete("established")).toBeNull();
    expect(channel.complete("closed")).toBeNull();
  });

  it("maps every TLS failure to a transport failure per the fixture", () => {
    for (const row of secureChannel.failure_mapping) {
      const outcome = row.outcome;
      const failure = secureChannelFailure(
        outcome as "handshake_failure" | "validation_failure" | "timeout" | "closed",
      );
      expect(failure, row.outcome).toEqual({ kind: row.transport_kind, message: row.message });
    }
  });

  it("failing the handshake emits connection_lost once and keeps the failure", () => {
    for (const outcome of ["handshake_failure", "validation_failure", "timeout", "closed"] as const) {
      const channel = new SecureChannelAttempt();
      channel.begin();
      expect(channel.complete(outcome)).toBe("connection_lost");
      expect(channel.currentPhase).toBe("failed");
      expect(channel.lastFailure).toEqual(secureChannelFailure(outcome));
      // Deterministic failure propagation/finalization.
      expect(channel.complete(outcome)).toBeNull();
      expect(channel.events()).toEqual([CONNECTION_LOST_EVENT]);
    }
  });

  it("aborting the handshake emits connection_lost once and is idempotent", () => {
    const channel = new SecureChannelAttempt();
    channel.begin();
    expect(channel.close()).toBe("connection_lost");
    expect(channel.currentPhase).toBe("closed");
    expect(channel.close()).toBeNull();
    expect(channel.events()).toEqual([CONNECTION_LOST_EVENT]);
  });

  it("reproduces the fixture outcome-to-event mapping deterministically", () => {
    for (const row of secureChannel.event_mapping) {
      const channel = new SecureChannelAttempt();
      channel.begin();
      const event = channel.complete(row.outcome as never);
      expect(event, row.outcome).toBe(row.event);
      expect(channel.events(), row.outcome).toEqual([row.event]);
    }
  });
});