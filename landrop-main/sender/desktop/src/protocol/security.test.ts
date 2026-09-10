import { describe, expect, it } from "vitest";

import { decodeMessage, ProtocolProblem } from "./codec";
import { encodeFrame, MAX_FRAME_PAYLOAD_BYTES } from "./framing";
import { JsonMessageStream } from "./message-stream";
import { DeliveryEngine } from "./delivery";
import type { DeliveryOutcome } from "./delivery";
import {
  DELIVERY_EVENTS,
  DELIVERY_STATES,
  DELIVERY_TERMINAL_STATES,
  transition,
} from "./state-machine";
import type { ControlMessage, DeliveryRequest } from "./types";

// ---------------------------------------------------------------------------
// Phase 09 — security hardening vectors: hostile wire input must never move a
// peer outside the frozen Delivery machine, never corrupt state on rejection,
// never install without VERIFIED -> INSTALL_READY, and never escape into the
// filesystem. Every assertion is deterministic.
// ---------------------------------------------------------------------------

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const security = fixtures.security as {
  metadata_path_vectors: { name: string; package_name: string; expect: string }[];
  duplicate_key_jsons: { name: string; json: string; expect: string }[];
  depth_bombs: { depth: number; expect: string }[];
  frame_boundaries: { name: string; length?: number; expect: string }[];
};

const SESSION_ID = "sess_01JTEST";
const TRANSFER_ID = "tr_01JTEST";
const DECLARED_SIZE = 100;
const SHA256_OK =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const SHA256_MISMATCH =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function makeRequest(packageName = "com.example.application"): DeliveryRequest {
  return {
    type: "delivery_request",
    protocol_version: 1,
    request_id: "req_01JTEST",
    session_id: SESSION_ID,
    presentation: { mode: "GUI" },
    sender: { display_name: "ISHAQ CYBERTECH" },
    application: {
      name: "My Application",
      version: "1.4.2",
      description: "A local test application.",
      package_name: packageName,
      size_bytes: DECLARED_SIZE,
      sha256: SHA256_OK,
    },
  };
}

type DecodeOutcome =
  | { kind: "message"; message: ControlMessage }
  | { kind: "problem"; problem: string };

function outcomeOf(text: string): DecodeOutcome {
  try {
    return { kind: "message", message: decodeMessage(text) };
  } catch (cause) {
    if (cause instanceof ProtocolProblem) {
      return { kind: "problem", problem: cause.code };
    }
    return { kind: "problem", problem: String(cause) };
  }
}

// --- Operation battery ------------------------------------------------------
// Every engine operation, exercised with hostile-but-well-typed arguments.
type Op = (engine: DeliveryEngine) => DeliveryOutcome;
type BatteryOp = readonly [name: string, run: Op];

const BATTERY: readonly BatteryOp[] = [
  ["receiveIncomingRequest(valid)", (e) => e.receiveIncomingRequest(makeRequest())],
  ["receiveIncomingRequest(foreign session)", (e) => e.receiveIncomingRequest({ ...makeRequest(), session_id: "sess_OTHER" })],
  ["registerDeliveryRequest(valid)", (e) => e.registerDeliveryRequest(makeRequest())],
  ["registerDeliveryRequest(foreign session)", (e) => e.registerDeliveryRequest({ ...makeRequest(), session_id: "sess_OTHER" })],
  ["awaitDecision", (e) => e.awaitDecision()],
  ["sendDecision(ACCEPT)", (e) => e.sendDecision("ACCEPT")],
  ["sendDecision(REJECT)", (e) => e.sendDecision("REJECT")],
  ["processResponse(ACCEPT)", (e) => e.processResponse({ type: "delivery_response", request_id: "req_01JTEST", decision: "ACCEPT" })],
  ["processResponse(REJECT)", (e) => e.processResponse({ type: "delivery_response", request_id: "req_01JTEST", decision: "REJECT" })],
  ["processResponse(wrong request_id)", (e) => e.processResponse({ type: "delivery_response", request_id: "req_WRONG", decision: "ACCEPT" })],
  ["expire", (e) => e.expire()],
  ["prepareTransfer", (e) => e.prepareTransfer()],
  ["beginTransfer(valid)", (e) => e.beginTransfer(TRANSFER_ID)],
  ["beginTransfer(traversal id)", (e) => e.beginTransfer("../../evil")],
  ["recordBytes(1)", (e) => e.recordBytes(1)],
  ["recordBytes(0)", (e) => e.recordBytes(0)],
  ["recordBytes(over declared)", (e) => e.recordBytes(DECLARED_SIZE + 1)],
  ["completeTransfer", (e) => e.completeTransfer()],
  ["completeVerification(match)", (e) => e.completeVerification(SHA256_OK)],
  ["completeVerification(mismatch)", (e) => e.completeVerification(SHA256_MISMATCH)],
  ["completeVerification(bad hex)", (e) => e.completeVerification("zz")],
  ["prepareInstall", (e) => e.prepareInstall()],
  ["handoffInstall", (e) => e.handoffInstall()],
  ["installationCompleted", (e) => e.installationCompleted()],
  ["installationUnavailable", (e) => e.installationUnavailable()],
  ["cancel", (e) => e.cancel()],
  ["processTransferCancel(match)", (e) => e.processTransferCancel(TRANSFER_ID)],
  ["processTransferCancel(mismatch)", (e) => e.processTransferCancel("tr_OTHER")],
  ["transferTimeout", (e) => e.transferTimeout()],
  ["connectionLost", (e) => e.connectionLost()],
];

// The receiver's canonical happy path, step by step. Each step must succeed and
// the fundamental invariant is asserted by the conformance sweep below.
interface PathStep {
  readonly name: string;
  readonly op: Op;
}

const RECEIVER_PATH: readonly PathStep[] = [
  { name: "receiveIncomingRequest", op: (e) => e.receiveIncomingRequest(makeRequest()) },
  { name: "awaitDecision", op: (e) => e.awaitDecision() },
  { name: "sendDecision(ACCEPT)", op: (e) => e.sendDecision("ACCEPT") },
  { name: "prepareTransfer", op: (e) => e.prepareTransfer() },
  { name: "beginTransfer(valid)", op: (e) => e.beginTransfer(TRANSFER_ID) },
  { name: "recordBytes(declared)", op: (e) => e.recordBytes(DECLARED_SIZE) },
  { name: "completeTransfer", op: (e) => e.completeTransfer() },
  { name: "completeVerification(match)", op: (e) => e.completeVerification(SHA256_OK) },
  { name: "prepareInstall", op: (e) => e.prepareInstall() },
  { name: "handoffInstall", op: (e) => e.handoffInstall() },
  { name: "installationCompleted", op: (e) => e.installationCompleted() },
];

// Replay path[0..stepIndex] into a fresh engine, exposing the state it reached.
function engineAt(stepIndex: number): DeliveryEngine {
  const engine = new DeliveryEngine(SESSION_ID);
  for (const step of RECEIVER_PATH.slice(0, stepIndex + 1)) {
    const outcome = step.op(engine);
    if (!outcome.ok) throw new Error(`replay failed at ${step.name}: ${outcome.problem}`);
  }
  return engine;
}

// ============================================================================
// 1. Frozen Delivery machine — exhaustive conformance
// ============================================================================

describe("phase 09 — machine conformance (18 states x 21 events)", () => {
  it("every declared edge is inside the machine and every unlisted edge is rejected", () => {
    for (const from of DELIVERY_STATES) {
      for (const event of DELIVERY_EVENTS) {
        const t = transition(from, event);
        if (t.ok) {
          expect(DELIVERY_STATES).toContain(t.to);
          // COMPLETED is only reachable through the installer handoff.
          if (t.to === "COMPLETED") expect(from).toBe("INSTALLATION_HANDOFF");
        } else {
          expect(t.reason).toBe("INVALID_TRANSITION");
        }
      }
    }
  });

  it("terminal states deny every one of the 21 events", () => {
    for (const from of DELIVERY_TERMINAL_STATES) {
      for (const event of DELIVERY_EVENTS) {
        expect(transition(from, event).ok, `${from}.${event}`).toBe(false);
      }
    }
  });

  it("V2 — no path from VERIFYING to COMPLETED (verification cannot be skipped)", () => {
    expect(transition("VERIFYING", "install_prepared").ok).toBe(false);
    expect(transition("VERIFYING", "handoff_initiated").ok).toBe(false);
    expect(transition("VERIFYING", "completed").ok).toBe(false);
  });

  it("V3 — no path from TRANSFERRING to installation (partial bytes cannot install)", () => {
    expect(transition("TRANSFERRING", "install_prepared").ok).toBe(false);
    expect(transition("TRANSFERRING", "handoff_initiated").ok).toBe(false);
    expect(transition("TRANSFERRING", "completed").ok).toBe(false);
    expect(transition("TRANSFERRING", "verified").ok).toBe(false);
  });
});

// ============================================================================
// 2. Engine conformance — every operation either follows the machine or fails
//    closed (state preserved, no side-effect instruction, no event).
// ============================================================================

describe("phase 09 — engine conformance along the receiver path", () => {
  for (let stepIndex = 0; stepIndex < RECEIVER_PATH.length; stepIndex++) {
    const stepName = RECEIVER_PATH[stepIndex]?.name ?? "<unknown>";
    it(`at "${stepName}" every battery operation follows the machine or fails closed`, () => {
      for (const [opName, run] of BATTERY) {
        const engine = engineAt(stepIndex);
        const before = engine.state;
        const outcome = run(engine);
        if (outcome.ok) {
          // Success implies a real machine edge (or a pure observation op).
          if (outcome.event !== null) {
            const t = transition(before, outcome.event);
            expect(t.ok, `${opName} claimed a non-edge event ${outcome.event}`).toBe(true);
            if (t.ok) expect(outcome.to).toBe(t.to);
          } else {
            expect(outcome.to).toBeNull();
          }
        } else {
          // Rejection must be total: no event, no target, no action, state held.
          expect(outcome.event, `${opName} at ${before} leaked an event: ${outcome.problem}`).toBeNull();
          expect(outcome.to, `${opName} at ${before} leaked a target`).toBeNull();
          expect(outcome.action.kind, `${opName} at ${before} emitted an instruction: ${outcome.problem}`).toBe("none");
          expect(engine.state, `${opName} corrupted state`).toBe(before);
        }
      }
    });
  }
});

describe("phase 09 — terminal states are sealed against every operation", () => {
  const terminals: Record<string, DeliveryEngine> = {
    COMPLETED: engineAt(RECEIVER_PATH.length - 1),
    REJECTED: (() => {
      const e = new DeliveryEngine(SESSION_ID);
      e.receiveIncomingRequest(makeRequest());
      e.awaitDecision();
      e.sendDecision("REJECT");
      return e;
    })(),
    FAILED: (() => {
      const e = new DeliveryEngine(SESSION_ID);
      e.receiveIncomingRequest(makeRequest());
      e.awaitDecision();
      e.sendDecision("ACCEPT");
      e.prepareTransfer();
      e.beginTransfer(TRANSFER_ID);
      e.connectionLost();
      return e;
    })(),
    CANCELLED: (() => {
      const e = new DeliveryEngine(SESSION_ID);
      e.receiveIncomingRequest(makeRequest());
      e.awaitDecision();
      e.sendDecision("ACCEPT");
      e.prepareTransfer();
      e.cancel();
      return e;
    })(),
  };

  for (const [stateName, engine] of Object.entries(terminals)) {
    it(`${stateName} rejects every operation without mutation`, () => {
      for (const [opName, run] of BATTERY) {
        const outcome = run(engine);
        expect(outcome.ok, `${opName} at ${stateName}`).toBe(false);
        expect(outcome.event).toBeNull();
        expect(outcome.to).toBeNull();
        expect(outcome.action.kind).toBe("none");
        expect(engine.state).toBe(stateName);
      }
    });
  }
});

describe("phase 09 — install gating invariants at the engine", () => {
  it("an engine in VERIFYING cannot prepare or hand off installation", () => {
    const e = new DeliveryEngine(SESSION_ID);
    e.receiveIncomingRequest(makeRequest());
    e.awaitDecision();
    e.sendDecision("ACCEPT");
    e.prepareTransfer();
    e.beginTransfer(TRANSFER_ID);
    e.recordBytes(DECLARED_SIZE);
    expect(e.completeTransfer().ok).toBe(true);
    expect(e.state).toBe("VERIFYING");

    expect(e.prepareInstall().ok).toBe(false);
    expect(e.handoffInstall().ok).toBe(false);
    expect(e.installationCompleted().ok).toBe(false);
    expect(e.installationUnavailable().ok).toBe(false);
    expect(e.state).toBe("VERIFYING");

    // Only verified moves the machine: correct digest flips to VERIFIED.
    expect(e.completeVerification(SHA256_OK).ok).toBe(true);
    expect(e.state).toBe("VERIFIED");
    expect(e.prepareInstall().ok).toBe(true);
    expect(e.state).toBe("INSTALL_READY");
    expect(e.handoffInstall().ok).toBe(true);
    expect(e.state).toBe("INSTALLATION_HANDOFF");
  });

  it("an INTEGRITY_MISMATCH removes any route to installation", () => {
    const e = new DeliveryEngine(SESSION_ID);
    e.receiveIncomingRequest(makeRequest());
    e.awaitDecision();
    e.sendDecision("ACCEPT");
    e.prepareTransfer();
    e.beginTransfer(TRANSFER_ID);
    e.recordBytes(DECLARED_SIZE);
    e.completeTransfer();
    expect(e.completeVerification(SHA256_MISMATCH).problem).toBe("INTEGRITY_MISMATCH");
    expect(e.state).toBe("FAILED");
    expect(e.prepareInstall().ok).toBe(false);
    expect(e.handoffInstall().ok).toBe(false);
  });
});

describe("phase 09 — F-01 regression: rejected operations emit no side-effect instruction", () => {
  it("expire() at ACCEPTED is rejected with action none and state unchanged", () => {
    const e = new DeliveryEngine(SESSION_ID, "ACCEPTED");
    const outcome = e.expire();
    expect(outcome.ok).toBe(false);
    expect(outcome.problem).toBe("INVALID_STATE");
    expect(outcome.action.kind).toBe("none");
    expect(e.state).toBe("ACCEPTED");
  });

  it("connectionLost() at DISCOVERING is rejected with action none", () => {
    const e = new DeliveryEngine(SESSION_ID, "DISCOVERING");
    const outcome = e.connectionLost();
    expect(outcome.ok).toBe(false);
    expect(outcome.problem).toBe("INVALID_TRANSITION");
    expect(outcome.action.kind).toBe("none");
    expect(e.state).toBe("DISCOVERING");
  });

  it("cancel() at DISCOVERING is rejected with action none", () => {
    const e = new DeliveryEngine(SESSION_ID, "DISCOVERING");
    const outcome = e.cancel();
    expect(outcome.ok).toBe(false);
    expect(outcome.action.kind).toBe("none");
    expect(e.state).toBe("DISCOVERING");
  });
});

// ============================================================================
// 3. Codec hardening vectors driven by the shared fixture security block.
// ============================================================================

describe("phase 09 — metadata path traversal (SV.8)", () => {
  it("rejects every hostile package_name and accepts the canonical one", () => {
    for (const v of security.metadata_path_vectors) {
      const req = makeRequest(v.package_name);
      if (v.expect === "accepted") {
        expect(decodeMessage(JSON.stringify(req)), v.name).toEqual(req);
      } else {
        expect(() => decodeMessage(JSON.stringify(req)), v.name).toThrowError(ProtocolProblem);
      }
    }
  });
});

describe("phase 09 — duplicate JSON keys (SV.9)", () => {
  it("dup-key text decodes to exactly the same single outcome as its collapsed form", () => {
    for (const v of security.duplicate_key_jsons) {
      // JSON.parse already resolves duplicates to one value; re-encoding gives
      // the canonical single-key text. Determinism: both forms must yield the
      // identical decode outcome (message or problem) — never two messages and
      // never a crash.
      const collapsed = JSON.parse(v.json);
      const single = JSON.stringify(collapsed);
      expect(outcomeOf(v.json)).toEqual(outcomeOf(single));
    }
  });

  it("a duplicated package_name cannot smuggle a second metadata value", () => {
    const v = security.duplicate_key_jsons.find((c) => c.name === "duplicate_package_name");
    expect(v).toBeDefined();
    // Last value wins: the final "../../evil" is the operative value, so the
    // request must be rejected as INVALID_REQUEST (not accepted on the first,
    // benign value).
    const result = outcomeOf(v!.json);
    expect(result.kind).toBe("problem");
    if (result.kind === "problem") expect(result.problem).toBe("INVALID_METADATA");
  });
});

describe("phase 09 — bounded input depth (SV.10)", () => {
  it("never lets pathological nesting escape as an exception", () => {
    for (const v of security.depth_bombs) {
      const text = "[".repeat(v.depth) + "]".repeat(v.depth);
      const result = outcomeOf(text);
      expect(result.kind, `depth ${v.depth}`).toBe("problem");
      if (result.kind === "problem") expect(result.problem).toBe("INVALID_REQUEST");
    }
  });
});

// ============================================================================
// 4. Wire hardening — framing boundaries and fail-closed behaviour.
// ============================================================================

describe("phase 09 — frame boundaries (SV.7)", () => {
  it("drives the fixture frame_boundaries deterministically", () => {
    for (const v of security.frame_boundaries) {
      const stream = new JsonMessageStream();
      if (v.length !== undefined) {
        const header = new Uint8Array([
          (v.length >>> 24) & 0xff,
          (v.length >>> 16) & 0xff,
          (v.length >>> 8) & 0xff,
          v.length & 0xff,
        ]);
        stream.feed(header);
      } else {
        stream.feed(new Uint8Array([0, 0, 0, 0]));
      }
      const result = stream.readMessage();
      if (v.expect === "incomplete") {
        expect(result).toEqual({ outcome: "incomplete" });
      } else if (v.expect === "FRAME_TOO_LARGE") {
        expect(result).toEqual({ outcome: "frame-error", problem: { code: "FRAME_TOO_LARGE" } });
      } else {
        expect(result).toMatchObject({ outcome: "protocol-error", problem: { code: "INVALID_REQUEST" } });
      }
    }
  });

  it("frames sized exactly at the limit pass the encoder and fail only at decode", () => {
    const payload = new Uint8Array(MAX_FRAME_PAYLOAD_BYTES);
    const encoded = encodeFrame(payload);
    expect(encoded.ok).toBe(true);
    const stream = new JsonMessageStream();
    if (encoded.ok) stream.feed(encoded.bytes);
    expect(stream.readMessage()).toMatchObject({
      outcome: "protocol-error",
      problem: { code: "INVALID_REQUEST" },
    });
  });

  it("the encoder refuses a payload one byte over the limit", () => {
    expect(encodeFrame(new Uint8Array(MAX_FRAME_PAYLOAD_BYTES + 1)).ok).toBe(false);
  });

  it("framing fails closed after a length violation: hostile tails can never extract a message", () => {
    const stream = new JsonMessageStream();
    // Length field claims 65537 bytes (one over the limit) -> FRAME_TOO_LARGE.
    stream.feed(new Uint8Array([0x00, 0x01, 0x00, 0x01]));
    expect(stream.readMessage()).toMatchObject({
      outcome: "frame-error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
    // A perfectly valid frame immediately after must still be refused.
    const encoded = encodeFrame(
      new TextEncoder().encode(
        JSON.stringify({
          type: "delivery_response",
          request_id: "req_01JTEST",
          decision: "ACCEPT",
        }),
      ),
    );
    if (encoded.ok) stream.feed(encoded.bytes);
    expect(stream.readMessage()).toMatchObject({
      outcome: "frame-error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
    expect(stream.endOfStream()).toEqual({
      outcome: "frame-error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
  });
});