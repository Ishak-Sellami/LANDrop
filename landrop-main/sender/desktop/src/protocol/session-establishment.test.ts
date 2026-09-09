import { describe, expect, it } from "vitest";

import {
  establishSession,
  SESSION_ESTABLISHED_EVENT,
  sessionEstablishedEvent,
  supportsProtocolVersion,
} from "./session-establishment";
import type { SessionDraft } from "./session";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const negotiation = fixtures.negotiation as {
  supported_versions: number[];
  version_outcomes: { version: number; result: "supported" | "unsupported"; note?: string }[];
};

const deliveryEventMapping = fixtures.delivery_event_mapping as {
  layer: string;
  condition: string;
  event: string;
}[];

const VALID_DRAFT: SessionDraft = {
  session_id: "sess_01JTEST",
  protocol_version: 1,
  sender: { display_name: "ISHAQ CYBERTECH" },
  receiver: { device_name: "Test Device" },
  lifetime: { created_at_ms: 0, expires_at_ms: 1000 },
};

const PREREQUISITES = {
  transportEstablished: true,
  secureChannelEstablished: true,
};

describe("phase 05 — version negotiation (protocol spec §6; wire gap)", () => {
  it("supports only protocol version 1 per the fixture", () => {
    expect(negotiation.supported_versions).toEqual([1]);
    for (const ctx of negotiation.version_outcomes) {
      expect(supportsProtocolVersion(ctx.version), ctx.note ?? String(ctx.version)).toBe(
        ctx.result === "supported",
      );
    }
  });
});
describe("phase 05 — session establishment boundary", () => {
  it("establishes a session only with a valid draft and full prerequisites", () => {
    const result = establishSession(VALID_DRAFT, PREREQUISITES);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session.ok).toBe(true);
      if (result.session.ok) {
        expect(result.session.session.session_id).toBe("sess_01JTEST");
        expect(result.session.session.state).toBe("DISCOVERING");
      }
    }
    expect(sessionEstablishedEvent()).toBe("session_established");
  });

  it("refuses establishment without an open transport (never partially established)", () => {
    const result = establishSession(VALID_DRAFT, {
      transportEstablished: false,
      secureChannelEstablished: true,
    });
    expect(result).toEqual({ ok: false, problem: "CONNECTION_NOT_ESTABLISHED" });
  });

  it("refuses establishment without a secure channel", () => {
    const result = establishSession(VALID_DRAFT, {
      transportEstablished: true,
      secureChannelEstablished: false,
    });
    expect(result).toEqual({ ok: false, problem: "SECURE_CHANNEL_NOT_ESTABLISHED" });
  });

  it("refuses establishment for an unsupported protocol version", () => {
    const result = establishSession({ ...VALID_DRAFT, protocol_version: 2 }, PREREQUISITES);
    expect(result).toEqual({ ok: false, problem: "SESSION_ISSUE" });
  });

  it("reuses the Phase 04 session guards for invalid drafts", () => {
    const invalidId = establishSession({ ...VALID_DRAFT, session_id: "bad id!" }, PREREQUISITES);
    expect(invalidId).toEqual({ ok: false, problem: "SESSION_ISSUE" });
    const invalidLifetime = establishSession(
      { ...VALID_DRAFT, lifetime: { created_at_ms: 1000, expires_at_ms: 1000 } },
      PREREQUISITES,
    );
    expect(invalidLifetime).toEqual({ ok: false, problem: "SESSION_ISSUE" });
  });

it("never emits session_established without an explicit fulfilled establishment", () => {
    const events = [
      SESSION_ESTABLISHED_EVENT,
      sessionEstablishedEvent(),
    ];
    expect(events).toEqual(["session_established", "session_established"]);
    for (const ctx of deliveryEventMapping) {
      if (ctx.event === "session_established") {
        expect(ctx.condition).toBe("valid session created after negotiation");
        expect(ctx.layer).toBe("session");
      }
    }
  });

  it("is a deterministic function of (draft, prerequisites)", () => {
    const first = establishSession(VALID_DRAFT, PREREQUISITES);
    const second = establishSession(VALID_DRAFT, PREREQUISITES);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
