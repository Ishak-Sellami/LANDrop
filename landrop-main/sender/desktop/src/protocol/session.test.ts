import { describe, expect, it } from "vitest";

import {
  createSession,
  isSessionActive,
  isSessionExpired,
  sessionStatus,
} from "./session";
import type { DeviceInfo, Lifetime, SessionData } from "./types";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

interface SessionCase {
  session_id: string;
  protocol_version: number;
  created_at_ms: number;
  expires_at_ms: number;
  now_ms: number;
  status: "not_started" | "active" | "expired";
}

const sessionCases: SessionCase[] = (fixtures.session_cases as unknown[]).map(
  (c) => c as SessionCase,
);

const asSession = (c: SessionCase): SessionData => ({
  session_id: c.session_id,
  protocol_version: c.protocol_version,
  sender: { display_name: "ISHAQ CYBERTECH" },
  receiver: { device_name: "Test Device" },
  state: "SESSION_ESTABLISHED",
  lifetime: { created_at_ms: c.created_at_ms, expires_at_ms: c.expires_at_ms },
});

const caseOf = (index: number, nowMs: number): SessionCase => {
  const c = sessionCases[index];
  if (c === undefined) throw new Error("missing session case");
  return { ...c, now_ms: nowMs };
};

describe("fixture parity - session status", () => {
  it.each(sessionCases)(
    "classifies now_ms=$now_ms against [$created_at_ms, $expires_at_ms) as $status",
    (c) => {
      expect(sessionStatus(asSession(c), c.now_ms)).toBe(c.status);
      expect(isSessionActive(asSession(c), c.now_ms)).toBe(c.status === "active");
      expect(isSessionExpired(asSession(c), c.now_ms)).toBe(c.status === "expired");
    },
  );
});

describe("sessionStatus boundaries", () => {
  it("is active through expires_at_ms - 1 and expired from expires_at_ms", () => {
    expect(sessionStatus(asSession(caseOf(0, 0)), 0)).toBe("active");
    expect(sessionStatus(asSession(caseOf(0, 999)), 999)).toBe("active");
    expect(sessionStatus(asSession(caseOf(0, 1000)), 1000)).toBe("expired");
  });

  it("is not_started strictly before created_at_ms", () => {
    expect(sessionStatus(asSession(caseOf(4, 100)), 100)).toBe("not_started");
    expect(sessionStatus(asSession(caseOf(4, 499)), 499)).toBe("not_started");
    expect(sessionStatus(asSession(caseOf(4, 500)), 500)).toBe("active");
  });

  it("is deterministic for times outside the window", () => {
    expect(sessionStatus(asSession(caseOf(0, -10)), -10)).toBe("not_started");
    expect(sessionStatus(asSession(caseOf(0, 1e15)), 1e15)).toBe("expired");
  });
});

describe("createSession", () => {
  const base = {
    session_id: "sess_01JTEST",
    protocol_version: 1,
    sender: { display_name: "ISHAQ CYBERTECH" },
    receiver: { device_name: "Test Device" } satisfies DeviceInfo,
    lifetime: { created_at_ms: 0, expires_at_ms: 1000 } satisfies Lifetime,
  };

  it("creates a session in the initial delivery state", () => {
    const result = createSession(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.session).toEqual({
        session_id: "sess_01JTEST",
        protocol_version: 1,
        sender: base.sender,
        receiver: base.receiver,
        state: "DISCOVERING",
        lifetime: base.lifetime,
      });
    }
  });

  it("rejects an invalid session id", () => {
    const result = createSession({ ...base, session_id: "bad id!" });
    expect(result).toEqual({ ok: false, problem: "INVALID_SESSION_ID" });
  });

  it("rejects an unsupported protocol version", () => {
    const result = createSession({ ...base, protocol_version: 2 });
    expect(result).toEqual({ ok: false, problem: "UNSUPPORTED_PROTOCOL" });
  });

  it("rejects a zero-duration lifetime", () => {
    const result = createSession({
      ...base,
      lifetime: { created_at_ms: 100, expires_at_ms: 100 },
    });
    expect(result).toEqual({ ok: false, problem: "INVALID_LIFETIME" });
  });

  it("rejects an inverted lifetime", () => {
    const result = createSession({
      ...base,
      lifetime: { created_at_ms: 1000, expires_at_ms: 100 },
    });
    expect(result).toEqual({ ok: false, problem: "INVALID_LIFETIME" });
  });

  it("rejects non-integer times", () => {
    const fractional = createSession({
      ...base,
      lifetime: { created_at_ms: 0.5, expires_at_ms: 1000 },
    });
    expect(fractional).toEqual({ ok: false, problem: "INVALID_LIFETIME" });
    const nonInteger = createSession({
      ...base,
      lifetime: { created_at_ms: 0, expires_at_ms: 1000.1 },
    });
    expect(nonInteger).toEqual({ ok: false, problem: "INVALID_LIFETIME" });
  });

  it("rejects a negative created time", () => {
    const result = createSession({
      ...base,
      lifetime: { created_at_ms: -1, expires_at_ms: 1000 },
    });
    expect(result).toEqual({ ok: false, problem: "INVALID_LIFETIME" });
  });

  it("is platform-deterministic", () => {
    const a = createSession(base);
    const b = createSession(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});