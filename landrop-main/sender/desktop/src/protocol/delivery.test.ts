import { describe, expect, it } from "vitest";

import { decodeMessage, encodeMessage, ProtocolProblem } from "./codec";
import { DeliveryEngine, calculateTransferProgress, createDeliveryResponse, decisionEvent } from "./delivery";
import type { DeliveryState } from "./types";
import type { DeliveryEvent } from "./state-machine";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const lifecycle = fixtures.delivery_lifecycle as {
  session_id: string;
  request_id: string;
  transfer_id: string;
  declared_size: number;
  happy_path: DeliveryStep[];
  receiver_happy_path: DeliveryStep[];
  rejection_path: DeliveryStep[];
  expiration_path: DeliveryStep[];
  cancellation_during_prepare: DeliveryStep[];
  connection_loss_during_transfer: DeliveryStep[];
  transfer_timeout_during_transfer: DeliveryStep[];
};

interface DeliveryStep {
  op: string;
  event: DeliveryEvent;
  next: DeliveryState;
}

const requestFixture = () => {
  const req = fixtures.delivery_request as Record<string, unknown>;
  return {
    ...(req as object),
    session_id: lifecycle.session_id,
    request_id: lifecycle.request_id,
  };
};

const REQUEST = requestFixture() as Parameters<DeliveryEngine["receiveIncomingRequest"]>[0] & { type: "delivery_request" };

const ACCEPT_RESPONSE = {
  type: "delivery_response",
  request_id: lifecycle.request_id,
  decision: "ACCEPT",
} as const;

const REJECT_RESPONSE = {
  type: "delivery_response",
  request_id: lifecycle.request_id,
  decision: "REJECT",
} as const;

function senderEngine(): DeliveryEngine {
  return new DeliveryEngine(lifecycle.session_id);
}

function runPath(engine: DeliveryEngine, path: DeliveryStep[]): void {
  for (const step of path) {
    let outcome;
    switch (step.op) {
      case "send_request":
        outcome = engine.registerDeliveryRequest(REQUEST);
        break;
      case "receive_request":
        outcome = engine.receiveIncomingRequest(REQUEST);
        break;
      case "await_decision":
        outcome = engine.awaitDecision();
        break;
      case "accept":
        // Sender path: response comes from the Receiver. Receiver path uses
        // sendDecision; the runner below uses receiver-specific ops.
        outcome = engine.processResponse(ACCEPT_RESPONSE);
        break;
      case "reject":
        outcome = engine.processResponse(REJECT_RESPONSE);
        break;
      case "expire":
        outcome = engine.expire();
        break;
      case "cancel":
        outcome = engine.cancel();
        break;
      case "prepare_transfer":
        outcome = engine.prepareTransfer();
        break;
      case "begin_transfer":
        outcome = engine.beginTransfer(lifecycle.transfer_id);
        break;
      case "record_bytes":
        outcome = engine.recordBytes(lifecycle.declared_size);
        break;
      case "complete_transfer":
        outcome = engine.completeTransfer();
        break;
      case "connection_lost":
        outcome = engine.connectionLost();
        break;
      case "transfer_timeout":
        outcome = engine.transferTimeout();
        break;
      default:
        throw new Error(`unknown op ${step.op}`);
    }
    expect(outcome.ok, `${step.op}: ${step.event}`).toBe(true);
    expect(engine.state).toBe(step.next);
    if (step.event !== null) {
      expect(outcome.event).toBe(step.event);
      expect(outcome.to).toBe(step.next);
    }
  }
}

function receiverEngine(): DeliveryEngine {
  return new DeliveryEngine(lifecycle.session_id);
}

function runReceiverPath(engine: DeliveryEngine, path: DeliveryStep[]): void {
  for (const step of path) {
    let outcome;
    switch (step.op) {
      case "receive_request":
        outcome = engine.receiveIncomingRequest(REQUEST);
        break;
      case "await_decision":
        outcome = engine.awaitDecision();
        break;
      case "accept":
        outcome = engine.sendDecision("ACCEPT");
        break;
      case "reject":
        outcome = engine.sendDecision("REJECT");
        break;
      case "prepare_transfer":
        outcome = engine.prepareTransfer();
        break;
      case "begin_transfer":
        outcome = engine.beginTransfer(lifecycle.transfer_id);
        break;
      case "record_bytes":
        outcome = engine.recordBytes(lifecycle.declared_size);
        break;
      case "complete_transfer":
        outcome = engine.completeTransfer();
        break;
      default:
        throw new Error(`unknown receiver op ${step.op}`);
    }
    expect(outcome.ok, `${step.op}: ${step.event}`).toBe(true);
    expect(engine.state).toBe(step.next);
    if (step.event !== null) {
      expect(outcome.event).toBe(step.event);
      expect(outcome.to).toBe(step.next);
    }
  }
}

// ============================================================================
// Pure helpers
// ============================================================================

describe("delivery — pure helpers", () => {
  it("decisionEvent maps ACCEPT -> accepted, REJECT -> rejected", () => {
    expect(decisionEvent("ACCEPT")).toBe("accepted");
    expect(decisionEvent("REJECT")).toBe("rejected");
  });

  it("createDeliveryResponse builds a valid wire response", () => {
    const resp = createDeliveryResponse("req_01JTEST", "ACCEPT");
    expect(resp).toEqual({ type: "delivery_response", request_id: "req_01JTEST", decision: "ACCEPT" });
    expect(decodeMessage(JSON.stringify(resp))).toEqual(resp);
  });

  it("calculateTransferProgress clamps into 0..100", () => {
    expect(calculateTransferProgress(0, 100)).toBe(0);
    expect(calculateTransferProgress(50, 100)).toBe(50);
    expect(calculateTransferProgress(100, 100)).toBe(100);
    expect(calculateTransferProgress(150, 100)).toBe(100);
    expect(calculateTransferProgress(-5, 100)).toBe(0);
    expect(calculateTransferProgress(10, 0)).toBe(0);
  });
});

// ============================================================================
// Fixture-driven lifecycle paths
// ============================================================================

describe("delivery — fixture lifecycle (Sender paths)", () => {
  it("happy path reaches verification_initiated (VERIFYING)", () => {
    runPath(senderEngine(), lifecycle.happy_path);
  });

  it("rejection path reaches REJECTED", () => {
    runPath(senderEngine(), lifecycle.rejection_path);
  });

  it("expiration path reaches FAILED", () => {
    runPath(senderEngine(), lifecycle.expiration_path);
  });

  it("cancellation during prepare reaches CANCELLED", () => {
    runPath(senderEngine(), lifecycle.cancellation_during_prepare);
  });

  it("connection loss during transfer reaches FAILED", () => {
    runPath(senderEngine(), lifecycle.connection_loss_during_transfer);
  });

  it("transfer timeout during transfer reaches FAILED", () => {
    runPath(senderEngine(), lifecycle.transfer_timeout_during_transfer);
  });
});

describe("delivery — fixture lifecycle (Receiver paths)", () => {
  it("receiver happy path uses sendDecision for ACCEPT", () => {
    runReceiverPath(receiverEngine(), lifecycle.receiver_happy_path);
  });

  it("receiver rejection path uses sendDecision for REJECT", () => {
    const path: DeliveryStep[] = [
      { op: "receive_request", event: "request_sent", next: "REQUEST_SENT" },
      { op: "await_decision", event: "awaiting_decision", next: "WAITING_FOR_DECISION" },
      { op: "reject", event: "rejected", next: "REJECTED" },
    ];
    runReceiverPath(receiverEngine(), path);
  });

  it("delivery_decisions fixture maps decisions to events and next states", () => {
    const decisions = fixtures.delivery_decisions as {
      decision: "ACCEPT" | "REJECT";
      event: DeliveryEvent;
      next: DeliveryState;
    }[];
    for (const row of decisions) {
      const engine = senderEngine();
      runPath(engine, lifecycle.happy_path.slice(0, 2));
      const outcome = engine.processResponse({
        type: "delivery_response",
        request_id: lifecycle.request_id,
        decision: row.decision,
      });
      expect(outcome.ok).toBe(true);
      expect(outcome.event).toBe(row.event);
      expect(outcome.to).toBe(row.next);
      expect(engine.state).toBe(row.next);
    }
  });
});

// ============================================================================
// Determinism
// ============================================================================

describe("delivery — determinism", () => {
  it("replaying the happy path produces identical events", () => {
    const events = (): DeliveryEvent[] => {
      const engine = senderEngine();
      const seen: DeliveryEvent[] = [];
      const ops = lifecycle.happy_path;
      for (const step of ops) {
        let outcome;
        switch (step.op) {
          case "send_request": outcome = engine.registerDeliveryRequest(REQUEST); break;
          case "await_decision": outcome = engine.awaitDecision(); break;
          case "accept": outcome = engine.processResponse(ACCEPT_RESPONSE); break;
          case "prepare_transfer": outcome = engine.prepareTransfer(); break;
          case "begin_transfer": outcome = engine.beginTransfer(lifecycle.transfer_id); break;
          case "record_bytes": outcome = engine.recordBytes(lifecycle.declared_size); break;
          case "complete_transfer": outcome = engine.completeTransfer(); break;
          default: throw new Error(`unexpected ${step.op}`);
        }
        if (outcome.ok && outcome.event !== null) seen.push(outcome.event);
      }
      return seen;
    };
    const first = events();
    const second = events();
    expect(second).toEqual(first);
    expect(first).toEqual([
      "request_sent",
      "awaiting_decision",
      "accepted",
      "transfer_prepared",
      "transfer_started",
      "verification_initiated",
    ]);
  });
});

// ============================================================================
// Byte accounting and size validation
// ============================================================================

describe("delivery — size validation", () => {
  function transferringEngine(): DeliveryEngine {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 5));
    return engine;
  }

  it("recordBytes accumulates and progress is clamped", () => {
    const engine = transferringEngine();
    const r1 = engine.recordBytes(1000);
    expect(r1.ok).toBe(true);
    expect(r1.event).toBeNull();
    expect(engine.state).toBe("TRANSFERRING");
    expect(engine.progressPercent).toBe(0);
    const r2 = engine.recordBytes(26003608);
    expect(r2.ok).toBe(true);
    expect(engine.bytesTransferred).toBe(26004608);
  });

  it("records exactly the declared size then completes", () => {
    const engine = transferringEngine();
    engine.recordBytes(lifecycle.declared_size);
    const done = engine.completeTransfer();
    expect(done.ok).toBe(true);
    expect(done.event).toBe("verification_initiated");
    expect(engine.state).toBe("VERIFYING");
  });

  it("premature EOF (short bytes) fails completeTransfer with SIZE_MISMATCH", () => {
    const engine = transferringEngine();
    engine.recordBytes(lifecycle.declared_size - 1);
    const done = engine.completeTransfer();
    expect(done.ok).toBe(false);
    expect(done.problem).toBe("SIZE_MISMATCH");
    expect(engine.state).toBe("TRANSFERRING");
  });

  it("recordBytes exceeding the declared size fails with SIZE_EXCEEDED", () => {
    const engine = transferringEngine();
    const over = engine.recordBytes(lifecycle.declared_size + 1);
    expect(over.ok).toBe(false);
    expect(over.problem).toBe("SIZE_EXCEEDED");
    expect(engine.state).toBe("TRANSFERRING");
    expect(engine.bytesTransferred).toBe(0);
  });

  it("recordBytes rejects non-positive counts", () => {
    const engine = transferringEngine();
    expect(engine.recordBytes(0).problem).toBe("INVALID_BYTES");
    expect(engine.recordBytes(-1).problem).toBe("INVALID_BYTES");
    expect(engine.recordBytes(1.5).problem).toBe("INVALID_BYTES");
  });

  it("beginTransfer rejects an invalid transfer_id", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 4));
    const bad = engine.beginTransfer("has space");
    expect(bad.ok).toBe(false);
    expect(bad.problem).toBe("INVALID_TRANSFER_ID");
    expect(engine.state).toBe("TRANSFER_PREPARING");
  });
});

// ============================================================================
// Invalid operations / state-gating / duplicate handling
// ============================================================================

describe("delivery — invalid operations are state-gated", () => {
  it("registerDeliveryRequest requires SESSION_ESTABLISHED", () => {
    const engine = senderEngine();
    engine.registerDeliveryRequest(REQUEST);
    const dup = engine.registerDeliveryRequest(REQUEST);
    expect(dup.ok).toBe(false);
    expect(dup.problem).toBe("INVALID_STATE");
  });

  it("await_decision requires REQUEST_SENT", () => {
    const engine = senderEngine();
    expect(engine.awaitDecision().problem).toBe("INVALID_STATE");
  });

  it("processResponse requires WAITING_FOR_DECISION", () => {
    const engine = senderEngine();
    expect(engine.processResponse(ACCEPT_RESPONSE).problem).toBe("INVALID_STATE");
  });

  it("processResponse rejects a mismatched request_id (RESPONSE_MISMATCH)", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 2));
    const out = engine.processResponse({
      type: "delivery_response",
      request_id: "req_OTHER",
      decision: "ACCEPT",
    });
    expect(out.ok).toBe(false);
    expect(out.problem).toBe("RESPONSE_MISMATCH");
    expect(engine.state).toBe("WAITING_FOR_DECISION");
  });

  it("a duplicate decision is rejected (no state corruption)", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 3));
    const dup = engine.processResponse(ACCEPT_RESPONSE);
    expect(dup.ok).toBe(false);
    expect(dup.problem).toBe("INVALID_STATE");
    expect(engine.state).toBe("ACCEPTED");
  });

  it("a decision after rejection is rejected", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.rejection_path);
    const after = engine.processResponse(ACCEPT_RESPONSE);
    expect(after.ok).toBe(false);
    expect(after.problem).toBe("INVALID_STATE");
    expect(engine.state).toBe("REJECTED");
  });

  it("a decision after expiry is rejected", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.expiration_path);
    const after = engine.processResponse(ACCEPT_RESPONSE);
    expect(after.ok).toBe(false);
    expect(after.problem).toBe("INVALID_STATE");
  });

  it("a decision after cancellation is rejected", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.cancellation_during_prepare);
    const after = engine.processResponse(ACCEPT_RESPONSE);
    expect(after.ok).toBe(false);
    expect(after.problem).toBe("INVALID_STATE");
  });

  it("receiveIncomingRequest rejects a request for another session", () => {
    const engine = receiverEngine();
    const foreign = { ...REQUEST, session_id: "sess_OTHER" };
    const out = engine.receiveIncomingRequest(foreign);
    expect(out.ok).toBe(false);
    expect(out.problem).toBe("REQUEST_MISMATCH");
    expect(engine.state).toBe("SESSION_ESTABLISHED");
  });

  it("completeTransfer before begin is rejected (NO_TRANSFER / INVALID_STATE)", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 4));
    expect(engine.completeTransfer().problem).toBe("INVALID_STATE");
  });

  it("processTransferCancel with a mismatched transfer_id is rejected", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 5));
    const out = engine.processTransferCancel("tr_OTHER");
    expect(out.ok).toBe(false);
    expect(out.problem).toBe("TRANSFER_ID_MISMATCH");
    expect(engine.state).toBe("TRANSFERRING");
  });

  it("processTransferCancel with a matching transfer_id cancels", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 5));
    const out = engine.processTransferCancel(lifecycle.transfer_id);
    expect(out.ok).toBe(true);
    expect(out.event).toBe("cancelled");
    expect(engine.state).toBe("CANCELLED");
  });

  it("expire is only valid from WAITING_FOR_DECISION", () => {
    const engine = senderEngine();
    expect(engine.expire().problem).toBe("INVALID_STATE");
  });

  it("transferTimeout is only valid from TRANSFERRING", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 2));
    expect(engine.transferTimeout().problem).toBe("INVALID_STATE");
  });
});

// ============================================================================
// Terminal-state invariants
// ============================================================================

describe("delivery — terminal states remain terminal", () => {
  const terminalStates: DeliveryState[] = ["COMPLETED", "REJECTED", "FAILED", "CANCELLED"];

  it("no delivery, accept, reject, cancel, or transfer after terminal", () => {
    for (const state of terminalStates) {
      const engine = new DeliveryEngine(lifecycle.session_id, state);
      expect(engine.registerDeliveryRequest(REQUEST).problem).toBe("INVALID_STATE");
      expect(engine.awaitDecision().problem).toBe("INVALID_STATE");
      expect(engine.processResponse(ACCEPT_RESPONSE).problem).toBe("INVALID_STATE");
      expect(engine.expire().problem).toBe("INVALID_STATE");
      expect(engine.cancel().problem).toBe("INVALID_STATE");
      expect(engine.prepareTransfer().problem).toBe("INVALID_STATE");
      expect(engine.beginTransfer(lifecycle.transfer_id).problem).toBe("INVALID_STATE");
      expect(engine.completeTransfer().problem).toBe("INVALID_STATE");
      expect(engine.transferTimeout().problem).toBe("INVALID_STATE");
      expect(engine.connectionLost().problem ?? "INVALID_STATE").toBe("INVALID_STATE");
      expect(engine.processTransferCancel(lifecycle.transfer_id).problem ?? "INVALID_STATE").toBe("INVALID_STATE");
      expect(engine.state).toBe(state);
    }
  });

  it("connection loss at every live stage routes to FAILED", () => {
    const routes: [string, DeliveryEvent, DeliveryState][] = [
      ["send_request", "request_sent", "REQUEST_SENT"],
      ["await_decision", "awaiting_decision", "WAITING_FOR_DECISION"],
      ["accept", "accepted", "ACCEPTED"],
      ["prepare_transfer", "transfer_prepared", "TRANSFER_PREPARING"],
      ["begin_transfer", "transfer_started", "TRANSFERRING"],
    ];
    // Rebuild each prefix separately so the engine starts fresh per scenario.
    for (let len = 0; len <= routes.length; len++) {
      const engine = senderEngine();
      for (let i = 0; i < len; i++) {
        const [, event, to] = routes[i] as [string, DeliveryEvent, DeliveryState];
        let out;
        if (event === "request_sent") out = engine.registerDeliveryRequest(REQUEST);
        else if (event === "awaiting_decision") out = engine.awaitDecision();
        else if (event === "accepted") out = engine.processResponse(ACCEPT_RESPONSE);
        else if (event === "transfer_prepared") out = engine.prepareTransfer();
        else if (event === "transfer_started") out = engine.beginTransfer(lifecycle.transfer_id);
        else throw new Error(`unhandled ${event}`);
        expect(out.ok).toBe(true);
        expect(engine.state).toBe(to);
      }
      const lost = engine.connectionLost();
      expect(lost.ok, `connection_lost from ${engine.state}`).toBe(true);
      expect(engine.state).toBe("FAILED");
    }
  });
});

// ============================================================================
// Action instructions (pure layer -> side-effect layer)
// ============================================================================

describe("delivery — side-effect instructions", () => {
  it("registerDeliveryRequest asks to send the request message", () => {
    const engine = senderEngine();
    const out = engine.registerDeliveryRequest(REQUEST);
    expect(out.ok).toBe(true);
    expect(out.action.kind).toBe("send_message");
    if (out.action.kind === "send_message") {
      expect(out.action.message.type).toBe("delivery_request");
    }
  });

  it("sendDecision(ACCEPT) asks to send the response message", () => {
    const engine = receiverEngine();
    runReceiverPath(engine, lifecycle.receiver_happy_path.slice(0, 2));
    const out = engine.sendDecision("ACCEPT");
    expect(out.ok).toBe(true);
    expect(out.action.kind).toBe("send_message");
    if (out.action.kind === "send_message") {
      expect(out.action.message).toEqual(ACCEPT_RESPONSE);
    }
  });

  it("sendDecision(REJECT) also asks to send the response message (spec §15)", () => {
    const engine = receiverEngine();
    runReceiverPath(engine, lifecycle.receiver_happy_path.slice(0, 2));
    const out = engine.sendDecision("REJECT");
    expect(out.ok).toBe(true);
    expect(out.action.kind).toBe("send_message");
    if (out.action.kind === "send_message") {
      expect(out.action.message).toEqual(REJECT_RESPONSE);
    }
  });

  it("beginTransfer asks to begin the stream and cancel asks to stop it", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.happy_path.slice(0, 4));
    const begin = engine.beginTransfer(lifecycle.transfer_id);
    expect(begin.ok).toBe(true);
    expect(begin.action.kind).toBe("begin_stream");
    const incoming = engine.processTransferCancel(lifecycle.transfer_id);
    expect(incoming.ok).toBe(true);
    expect(incoming.action.kind).toBe("stop_stream");
  });

  it("cancel requests cleanup", () => {
    const engine = senderEngine();
    runPath(engine, lifecycle.cancellation_during_prepare.slice(0, 3));
    const out = engine.cancel();
    expect(out.ok).toBe(true);
    expect(out.action.kind).toBe("cleanup");
  });
});

// ============================================================================
// Wire codec: transfer_progress / transfer_cancel
// ============================================================================

describe("delivery — wire transfer messages (spec §19, §24)", () => {
  it("transfer_progress round-trips through the codec", () => {
    const msg = fixtures.transfer_progress_message as Record<string, unknown>;
    const decoded = decodeMessage(JSON.stringify(msg));
    expect(decoded.type).toBe("transfer_progress");
    const json = encodeMessage(decoded);
    expect(JSON.parse(json)).toEqual(msg);
  });

  it("transfer_cancel round-trips through the codec", () => {
    const msg = fixtures.transfer_cancel_message as Record<string, unknown>;
    const decoded = decodeMessage(JSON.stringify(msg));
    expect(decoded.type).toBe("transfer_cancel");
    const json = encodeMessage(decoded);
    expect(JSON.parse(json)).toEqual(msg);
  });

  it("progress bytes mapping matches the fixture payload", () => {
    const msg = fixtures.transfer_progress_message as {
      bytes_transferred: number;
      total_bytes: number;
    };
    expect(calculateTransferProgress(msg.bytes_transferred, msg.total_bytes)).toBe(56);
  });

  it("invalid transfer messages are rejected by the codec", () => {
    const invalid = fixtures.invalid_transfer_messages as unknown[];
    for (const msg of invalid) {
      expect(() => decodeMessage(JSON.stringify(msg))).toThrow(ProtocolProblem);
    }
  });

  it("fixture declares valid transfer_progress/transfer_cancel messages", () => {
    for (const msg of [fixtures.transfer_progress_message, fixtures.transfer_cancel_message]) {
      expect(() => decodeMessage(JSON.stringify(msg))).not.toThrow();
    }
  });
});

// ============================================================================
// Phase 07 — integrity verification & installation handoff (spec §20-§23,
// project spec §14/§24/§26)
// ============================================================================

const EXPECTED_DIGEST = (fixtures.delivery_request as {
  application: { sha256: string };
}).application.sha256;

const OTHER_DIGEST =
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

function verifyingReceiver(): DeliveryEngine {
  const engine = receiverEngine();
  runReceiverPath(engine, lifecycle.receiver_happy_path);
  expect(engine.state).toBe("VERIFYING");
  return engine;
}

function verifiedReceiver(): DeliveryEngine {
  const engine = verifyingReceiver();
  const out = engine.completeVerification(EXPECTED_DIGEST);
  expect(out.ok).toBe(true);
  expect(engine.state).toBe("VERIFIED");
  return engine;
}

function installReadyReceiver(): DeliveryEngine {
  const engine = verifiedReceiver();
  const out = engine.prepareInstall();
  expect(out.ok).toBe(true);
  expect(engine.state).toBe("INSTALL_READY");
  return engine;
}

function handoffReceiver(): DeliveryEngine {
  const engine = installReadyReceiver();
  const out = engine.handoffInstall();
  expect(out.ok).toBe(true);
  expect(engine.state).toBe("INSTALLATION_HANDOFF");
  return engine;
}

describe("delivery — integrity verification (spec §20-§21)", () => {
  it("a matching digest verifies the artifact (VERIFIED)", () => {
    const engine = verifyingReceiver();
    const out = engine.completeVerification(EXPECTED_DIGEST);
    expect(out.ok).toBe(true);
    expect(out.event).toBe("verified");
    expect(out.to).toBe("VERIFIED");
    expect(out.action.kind).toBe("none");
    expect(out.problem).toBeNull();
    expect(engine.state).toBe("VERIFIED");
    expect(engine.expectedDigest).toBe(EXPECTED_DIGEST);
  });

  it("the declared digest is compared case-insensitively", () => {
    const engine = verifyingReceiver();
    const out = engine.completeVerification(EXPECTED_DIGEST.toUpperCase());
    expect(out.ok).toBe(true);
    expect(out.event).toBe("verified");
    expect(engine.state).toBe("VERIFIED");
  });

  it("a mismatched digest blocks installation (INTEGRITY_MISMATCH)", () => {
    const engine = verifyingReceiver();
    const out = engine.completeVerification(OTHER_DIGEST);
    expect(out.ok).toBe(true);
    expect(out.event).toBe("integrity_mismatch");
    expect(out.to).toBe("FAILED");
    expect(out.action.kind).toBe("cleanup");
    expect(out.problem).toBe("INTEGRITY_MISMATCH");
    expect(engine.state).toBe("FAILED");
  });

  it("verification only runs from VERIFYING", () => {
    const engine = verifiedReceiver();
    expect(engine.completeVerification(EXPECTED_DIGEST).problem).toBe("INVALID_STATE");
  });

  it("a malformed computed digest is rejected before any transition", () => {
    const engine = verifyingReceiver();
    expect(engine.completeVerification("not-a-digest").problem).toBe("INVALID_DIGEST");
    expect(engine.completeVerification("abc").problem).toBe("INVALID_DIGEST");
    expect(engine.state).toBe("VERIFYING");
  });

  it("verification requires an active delivery request", () => {
    const bare = new DeliveryEngine(lifecycle.session_id, "VERIFYING");
    expect(bare.completeVerification(EXPECTED_DIGEST).problem).toBe("NO_REQUEST");
  });

  it("the mismatch outcome is terminal — nothing proceeds after it", () => {
    const engine = verifyingReceiver();
    expect(engine.completeVerification(OTHER_DIGEST).ok).toBe(true);
    expect(engine.state).toBe("FAILED");
    expect(engine.prepareInstall().problem).toBe("INVALID_STATE");
    expect(engine.cancel().problem).toBe("INVALID_STATE");
  });
});

describe("delivery — installation handoff (spec §23, project §26)", () => {
  it("prepareInstall moves VERIFIED → INSTALL_READY, once", () => {
    const engine = verifiedReceiver();
    const out = engine.prepareInstall();
    expect(out.ok).toBe(true);
    expect(out.event).toBe("install_prepared");
    expect(out.to).toBe("INSTALL_READY");
    expect(out.action.kind).toBe("none");
    expect(engine.state).toBe("INSTALL_READY");
    expect(engine.prepareInstall().problem).toBe("INVALID_STATE");
  });

  it("handoff and prepare are gated to their stages", () => {
    const engine = verifyingReceiver();
    expect(engine.prepareInstall().problem).toBe("INVALID_STATE");
    expect(engine.handoffInstall().problem).toBe("INVALID_STATE");
    expect(engine.installationCompleted().problem).toBe("INVALID_STATE");
  });

  it("handoffInstall asks the application layer to invoke the installer", () => {
    const engine = installReadyReceiver();
    const out = engine.handoffInstall();
    expect(out.ok).toBe(true);
    expect(out.event).toBe("handoff_initiated");
    expect(out.to).toBe("INSTALLATION_HANDOFF");
    expect(out.action.kind).toBe("invoke_installer");
    expect(engine.state).toBe("INSTALLATION_HANDOFF");
  });

  it("installationCompleted is driven only by the platform's real completion", () => {
    const engine = handoffReceiver();
    const out = engine.installationCompleted();
    expect(out.ok).toBe(true);
    expect(out.event).toBe("completed");
    expect(out.to).toBe("COMPLETED");
    expect(out.action.kind).toBe("cleanup");
    expect(engine.state).toBe("COMPLETED");
    expect(engine.installationCompleted().problem).toBe("INVALID_STATE");
  });

  it("installationUnavailable fails the delivery before handoff", () => {
    const engine = installReadyReceiver();
    const out = engine.installationUnavailable();
    expect(out.ok).toBe(true);
    expect(out.event).toBe("installation_unavailable");
    expect(out.to).toBe("FAILED");
    expect(out.action.kind).toBe("cleanup");
    expect(engine.state).toBe("FAILED");
  });

  it("installationUnavailable fails the delivery during handoff", () => {
    const engine = handoffReceiver();
    const out = engine.installationUnavailable();
    expect(out.ok).toBe(true);
    expect(out.event).toBe("installation_unavailable");
    expect(out.to).toBe("FAILED");
    expect(engine.state).toBe("FAILED");
  });

  it("installationUnavailable requires an install stage", () => {
    const engine = verifiedReceiver();
    expect(engine.installationUnavailable().problem).toBe("INVALID_STATE");
  });

  it("the machine stays frozen: no cancel from INSTALLATION_HANDOFF, no connection loss from VERIFIED", () => {
    const handoff = handoffReceiver();
    const cancel = handoff.cancel();
    expect(cancel.ok).toBe(false);
    expect(cancel.problem).toBe("INVALID_TRANSITION");
    expect(handoff.state).toBe("INSTALLATION_HANDOFF");

    const verified = verifiedReceiver();
    const lost = verified.connectionLost();
    expect(lost.ok).toBe(false);
    expect(lost.problem).toBe("INVALID_TRANSITION");
    expect(verified.state).toBe("VERIFIED");
  });

  it("cancellation still works from VERIFIED and INSTALL_READY", () => {
    const fromVerified = verifiedReceiver();
    expect(fromVerified.cancel().ok).toBe(true);
    expect(fromVerified.state).toBe("CANCELLED");

    const fromReady = installReadyReceiver();
    expect(fromReady.cancel().ok).toBe(true);
    expect(fromReady.state).toBe("CANCELLED");
  });

  it("the full receiver lifecycle completes deterministically", () => {
    const engine = receiverEngine();
    runReceiverPath(engine, lifecycle.receiver_happy_path);
    expect(engine.completeVerification(EXPECTED_DIGEST.toUpperCase()).ok).toBe(true);
    expect(engine.prepareInstall().ok).toBe(true);
    expect(engine.handoffInstall().ok).toBe(true);
    expect(engine.installationCompleted().ok).toBe(true);
    expect(engine.state).toBe("COMPLETED");
    expect(engine.completeVerification(EXPECTED_DIGEST).problem).toBe("INVALID_STATE");
    expect(engine.prepareInstall().problem).toBe("INVALID_STATE");
    expect(engine.handoffInstall().problem).toBe("INVALID_STATE");
    expect(engine.installationUnavailable().problem).toBe("INVALID_STATE");
  });

  it("the new operations are rejected from every terminal state", () => {
    const terminals: DeliveryState[] = ["COMPLETED", "REJECTED", "FAILED", "CANCELLED"];
    for (const state of terminals) {
      const engine = new DeliveryEngine(lifecycle.session_id, state);
      expect(engine.completeVerification(EXPECTED_DIGEST).problem).toBe("INVALID_STATE");
      expect(engine.prepareInstall().problem).toBe("INVALID_STATE");
      expect(engine.handoffInstall().problem).toBe("INVALID_STATE");
      expect(engine.installationCompleted().problem).toBe("INVALID_STATE");
      expect(engine.installationUnavailable().problem).toBe("INVALID_STATE");
    }
  });
});