import { describe, expect, it } from "vitest";

import { encodeFrame } from "./framing";
import type { ControlMessage, Decision, DeliveryRequest, DeliveryResponse, TransferCancel } from "./types";
import { DeliveryEngine, type DeliveryOutcome } from "./delivery";
import type { DeliveryEvent } from "./state-machine";
import { createInMemoryDuplex, type DuplexTransport, type Transport } from "./transport";
import { JsonMessageStream, encodeJsonFrame } from "./message-stream";
import type { JsonMessageResult } from "./message-stream";

// ---------------------------------------------------------------------------
// Deterministic over-the-wire harness
// ---------------------------------------------------------------------------
//
// Mirrors architecture §21/§29: the application layer owns the Transport + a
// JsonMessageStream per peer; the DeliveryEngine stays pure and emits actions.
// The harness executes engine actions: send_message writes an encoded frame to
// the peer's inbound buffer; begin/stop/cleanup are recorded as side effects.
// The binary APK stream (spec §17) is a recorded specification gap, so the
// application bytes are modelled via engine.recordBytes() only.

interface PeerEffects {
  begun: number;
  stopped: number;
  cleanups: number;
}

class DeliveryFlowPeer {
  readonly engine: DeliveryEngine;
  readonly received: ControlMessage[] = [];
  readonly sent: ControlMessage[] = [];
  readonly effects: PeerEffects = { begun: 0, stopped: 0, cleanups: 0 };
  readonly stream = new JsonMessageStream();

  constructor(
    readonly sessionId: string,
    private readonly transport: Transport,
  ) {
    this.engine = new DeliveryEngine(sessionId);
  }

  run(outcome: DeliveryOutcome): DeliveryOutcome {
    expect(outcome.ok, `${outcome.problem ?? "failure"} at ${this.engine.state}`).toBe(true);
    switch (outcome.action.kind) {
      case "send_message":
        this.write(outcome.action.message);
        break;
      case "begin_stream":
        this.effects.begun += 1;
        break;
      case "stop_stream":
        this.effects.stopped += 1;
        break;
      case "cleanup":
        this.effects.cleanups += 1;
        break;
      case "none":
        break;
    }
    return outcome;
  }

  /** Write one message onto the wire (into the peer's inbound buffer). */
  write(message: ControlMessage): void {
    const encoded = encodeJsonFrame(message);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      const written = this.transport.write(encoded.bytes);
      expect(written.ok).toBe(true);
      if (written.ok) this.sent.push(message);
    }
  }

  /** Drain this side's inbound buffer into the message stream. */
  pump(): void {
    for (let i = 0; i < 8; i++) {
      const read = this.transport.read(4096);
      if (read.kind === "data") {
        if (read.bytes.length > 0) this.stream.feed(read.bytes);
      } else if (read.kind === "empty") {
        return;
      } else {
        return;
      }
    }
  }

  /** Read one complete message out of this side's stream, if any. */
  takeMessage(): JsonMessageResult {
    const result = this.stream.readMessage();
    if (result.outcome === "message") this.received.push(result.message);
    return result;
  }
}

function makeDuplex(): DuplexTransport {
  const duplex = createInMemoryDuplex();
  expect(duplex.left.connect().ok).toBe(true);
  expect(duplex.right.connect().ok).toBe(true);
  return duplex;
}

const SESSION_ID = "sess_01JTEST";
const REQUEST_ID = "req_01JTEST";
const TRANSFER_ID = "tr_01JTEST";
const DECLARED_SIZE = 26004608;

const REQUEST: DeliveryRequest = {
  type: "delivery_request",
  protocol_version: 1,
  request_id: REQUEST_ID,
  session_id: SESSION_ID,
  presentation: { mode: "GUI" },
  sender: { display_name: "ISHAQ CYBERTECH" },
  application: {
    name: "My Application",
    version: "1.4.2",
    description: "A local test application.",
    package_name: "com.example.application",
    size_bytes: DECLARED_SIZE,
    sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
};

function acceptResponse(): DeliveryResponse {
  return { type: "delivery_response", request_id: REQUEST_ID, decision: "ACCEPT" };
}
function rejectResponse(): DeliveryResponse {
  return { type: "delivery_response", request_id: REQUEST_ID, decision: "REJECT" };
}

/** Sender registers a request and both engines advance to WAITING_FOR_DECISION. */
function awaitingDecisionPair(): { sender: DeliveryFlowPeer; receiver: DeliveryFlowPeer } {
  const duplex = makeDuplex();
  const sender = new DeliveryFlowPeer(SESSION_ID, duplex.left);
  const receiver = new DeliveryFlowPeer(SESSION_ID, duplex.right);

  sender.run(sender.engine.registerDeliveryRequest(REQUEST));
  receiver.pump();
  const request = receiver.takeMessage();
  expect(request.outcome).toBe("message");
  if (request.outcome === "message") {
    expect(request.message.type).toBe("delivery_request");
    receiver.run(receiver.engine.receiveIncomingRequest(request.message as DeliveryRequest));
  }
  sender.run(sender.engine.awaitDecision());
  receiver.run(receiver.engine.awaitDecision());
  expect(sender.engine.state).toBe("WAITING_FOR_DECISION");
  expect(receiver.engine.state).toBe("WAITING_FOR_DECISION");
  return { sender, receiver };
}

/** Both engines accept and reach ACCEPTED, response frame travelling over the wire. */
function acceptedPair(): { sender: DeliveryFlowPeer; receiver: DeliveryFlowPeer } {
  const { sender, receiver } = awaitingDecisionPair();
  receiver.run(receiver.engine.sendDecision("ACCEPT"));
  sender.pump();
  const response = sender.takeMessage();
  expect(response.outcome).toBe("message");
  if (response.outcome === "message") {
    expect(response.message).toEqual(acceptResponse());
    sender.run(sender.engine.processResponse(response.message as DeliveryResponse));
  }
  expect(sender.engine.state).toBe("ACCEPTED");
  expect(receiver.engine.state).toBe("ACCEPTED");
  return { sender, receiver };
}

/** Both engines start an active transfer (TRANSFERRING). */
function transferringPair(): { sender: DeliveryFlowPeer; receiver: DeliveryFlowPeer } {
  const { sender, receiver } = acceptedPair();
  sender.run(sender.engine.prepareTransfer());
  receiver.run(receiver.engine.prepareTransfer());
  sender.run(sender.engine.beginTransfer(TRANSFER_ID));
  receiver.run(receiver.engine.beginTransfer(TRANSFER_ID));
  expect(sender.engine.state).toBe("TRANSFERRING");
  expect(receiver.engine.state).toBe("TRANSFERRING");
  return { sender, receiver };
}

// ============================================================================
// Happy path: request -> accept -> transfer -> verification boundary
// ============================================================================

describe("phase 06 — delivery flow over the wire (spec §8-§20)", () => {
  it("a delivery request frame travels sender -> receiver intact", () => {
    const duplex = makeDuplex();
    const sender = new DeliveryFlowPeer(SESSION_ID, duplex.left);
    const receiver = new DeliveryFlowPeer(SESSION_ID, duplex.right);

    sender.run(sender.engine.registerDeliveryRequest(REQUEST));
    expect(sender.engine.state).toBe("REQUEST_SENT");
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]).toMatchObject({ type: "delivery_request", request_id: REQUEST_ID });

    receiver.pump();
    const request = receiver.takeMessage();
    expect(request.outcome).toBe("message");
    if (request.outcome === "message") {
      expect(request.message).toEqual(REQUEST);
      expect(receiver.stream.bufferedBytes).toBe(0);
    }
  });

  it("ACCEPT response travels receiver -> sender and both reach ACCEPTED", () => {
    const { sender, receiver } = acceptedPair();
    expect(sender.engine.request?.request_id).toBe(REQUEST_ID);
    expect(receiver.engine.request?.request_id).toBe(REQUEST_ID);
    expect(receiver.sent[0]).toEqual(acceptResponse());
  });

  it("REJECT response travels receiver -> sender and both reach REJECTED", () => {
    const { sender, receiver } = awaitingDecisionPair();
    receiver.run(receiver.engine.sendDecision("REJECT"));
    sender.pump();
    const response = sender.takeMessage();
    expect(response.outcome).toBe("message");
    if (response.outcome === "message") {
      expect(response.message).toEqual(rejectResponse());
      sender.run(sender.engine.processResponse(response.message as DeliveryResponse));
    }
    expect(sender.engine.state).toBe("REJECTED");
    expect(receiver.engine.state).toBe("REJECTED");
    expect(receiver.engine.declaredSize).toBe(DECLARED_SIZE);
  });

  it("full transfer completes with both sides at verification_initiated (VERIFYING)", () => {
    const { sender, receiver } = transferringPair();
    // Application layer streams bytes and reports them to the engines.
    const chunk1 = 14800000;
    const chunk2 = 26004608 - chunk1;
    sender.run(sender.engine.recordBytes(chunk1));
    receiver.run(receiver.engine.recordBytes(chunk1));
    expect(sender.engine.progressPercent).toBe(56);
    expect(receiver.engine.progressPercent).toBe(56);
    sender.run(sender.engine.recordBytes(chunk2));
    receiver.run(receiver.engine.recordBytes(chunk2));
    expect(sender.engine.bytesTransferred).toBe(DECLARED_SIZE);

    sender.run(sender.engine.completeTransfer());
    receiver.run(receiver.engine.completeTransfer());
    expect(sender.engine.state).toBe("VERIFYING");
    expect(receiver.engine.state).toBe("VERIFYING");
    expect(sender.engine.transferId).toBe(TRANSFER_ID);
    expect(receiver.engine.transferId).toBe(TRANSFER_ID);
  });

  it("verification_initiated is the integrity-phase boundary (no auto-advance)", () => {
    const { sender, receiver } = transferringPair();
    sender.run(sender.engine.recordBytes(DECLARED_SIZE));
    receiver.run(receiver.engine.recordBytes(DECLARED_SIZE));
    sender.run(sender.engine.completeTransfer());
    receiver.run(receiver.engine.completeTransfer());
    // SHA-256 verification / INSTALL_READY / install handoff are NOT this phase:
    // the engine exposes no verified/install operations and stays at VERIFYING.
    expect(sender.engine.state).toBe("VERIFYING");
    expect(receiver.engine.state).toBe("VERIFYING");
    expect(sender.effects).toEqual({ begun: 1, stopped: 0, cleanups: 0 });
    expect(receiver.effects).toEqual({ begun: 1, stopped: 0, cleanups: 0 });
  });

  it("the ordered event sequence on both peers is deterministic and mirror-equal", () => {
    const sequence = (side: "sender" | "receiver"): DeliveryEvent[] => {
      const engine = new DeliveryEngine(SESSION_ID);
      const events: DeliveryEvent[] = [];
      const note = (o: DeliveryOutcome): void => {
        if (o.ok && o.event !== null) events.push(o.event);
      };
      if (side === "sender") {
        note(engine.registerDeliveryRequest(REQUEST));
      } else {
        note(
          engine.receiveIncomingRequest(REQUEST),
        );
      }
      note(engine.awaitDecision());
      if (side === "sender") {
        note(engine.processResponse(acceptResponse()));
      } else {
        note(engine.sendDecision("ACCEPT"));
      }
      note(engine.prepareTransfer());
      note(engine.beginTransfer(TRANSFER_ID));
      note(engine.recordBytes(DECLARED_SIZE));
      note(engine.completeTransfer());
      return events;
    };
    const expected: DeliveryEvent[] = [
      "request_sent",
      "awaiting_decision",
      "accepted",
      "transfer_prepared",
      "transfer_started",
      "verification_initiated",
    ];
    expect(sequence("sender")).toEqual(expected);
    expect(sequence("receiver")).toEqual(expected);
  });
});

// ============================================================================
// Wire transfer messages: transfer_progress / transfer_cancel (spec §19, §24)
// ============================================================================

describe("phase 06 — wire transfer messages (spec §19, §24)", () => {
  it("transfer_progress is an observation frame, not a state change", () => {
    const { sender, receiver } = transferringPair();
    const progress = {
      type: "transfer_progress",
      transfer_id: TRANSFER_ID,
      bytes_transferred: 14800000,
      total_bytes: DECLARED_SIZE,
    } as const;
    sender.write(progress as unknown as ControlMessage);
    receiver.pump();
    const received = receiver.takeMessage();
    expect(received.outcome).toBe("message");
    if (received.outcome === "message") {
      expect(received.message.type).toBe("transfer_progress");
    }
    // Progress is observation (§31), the machine stays in TRANSFERRING.
    expect(receiver.engine.state).toBe("TRANSFERRING");
    expect(sender.engine.state).toBe("TRANSFERRING");
  });

  it("transfer_cancel wires sender-side cancellation to receiver stop_stream", () => {
    const { sender, receiver } = transferringPair();
    // User cancels on the Sender: engine emits cleanup; the application layer
    // writes the transfer_cancel frame per spec §24, and the Receiver stops.
    const local = sender.engine.cancel();
    expect(local.ok).toBe(true);
    expect(local.action.kind).toBe("cleanup");
    expect(sender.engine.state).toBe("CANCELLED");

    const cancelMsg: TransferCancel = { type: "transfer_cancel", transfer_id: TRANSFER_ID };
    sender.write(cancelMsg);
    receiver.pump();
    const cancel = receiver.takeMessage();
    expect(cancel.outcome).toBe("message");
    if (cancel.outcome === "message") {
      const handled = receiver.run(receiver.engine.processTransferCancel((cancel.message as TransferCancel).transfer_id));
      expect(handled.action.kind).toBe("stop_stream");
      expect(receiver.effects.stopped).toBe(1);
    }
    expect(receiver.engine.state).toBe("CANCELLED");
  });

  it("invalid transfer frames surface as protocol-error, not engine corruption", () => {
    const duplex = makeDuplex();
    const sender = new DeliveryFlowPeer(SESSION_ID, duplex.left);
    const receiver = new DeliveryFlowPeer(SESSION_ID, duplex.right);
    sender.engine.registerDeliveryRequest(REQUEST);
    receiver.pump();
    receiver.engine.receiveIncomingRequest(REQUEST);
    receiver.run(receiver.engine.awaitDecision());

    // A malformed frame with an invalid transfer_progress (negative
    // bytes_transferred) is written directly as raw JSON to the wire,
    // bypassing the sender-side codec so the receiver's codec must reject it.
    const badPayload = new TextEncoder().encode(
      JSON.stringify({
        type: "transfer_progress",
        transfer_id: TRANSFER_ID,
        bytes_transferred: -1,
        total_bytes: DECLARED_SIZE,
      }),
    );
    const frame = encodeFrame(badPayload);
    expect(frame.ok).toBe(true);
    if (frame.ok) {
      const written = duplex.left.write(frame.bytes);
      expect(written.ok).toBe(true);
    }
    receiver.pump();
    const result = receiver.takeMessage();
    expect(result.outcome).toBe("protocol-error");
    expect(receiver.engine.state).toBe("WAITING_FOR_DECISION"); // untouched
  });
});

// ============================================================================
// Failure paths across the wire (spec §24-§27)
// ============================================================================

describe("phase 06 — failure paths over the wire", () => {
  it("expiry while awaiting a decision triggers cleanup on both peers", () => {
    const { sender, receiver } = awaitingDecisionPair();
    sender.run(sender.engine.expire());
    receiver.run(receiver.engine.expire());
    expect(sender.engine.state).toBe("FAILED");
    expect(receiver.engine.state).toBe("FAILED");
    expect(sender.effects.cleanups).toBe(1);
    expect(receiver.effects.cleanups).toBe(1);
    // Post-expiry decisions are rejected.
    expect(sender.engine.processResponse(acceptResponse()).ok).toBe(false);
  });

  it("transfer inactivity timeout during TRANSFERRING triggers cleanup", () => {
    const { sender, receiver } = transferringPair();
    sender.run(sender.engine.transferTimeout());
    receiver.run(receiver.engine.transferTimeout());
    expect(sender.engine.state).toBe("FAILED");
    expect(receiver.engine.state).toBe("FAILED");
    expect(sender.effects.cleanups).toBe(1);
  });

  it("connection loss at any transfer stage routes both sides to FAILED", () => {
    const { sender, receiver } = transferringPair();
    sender.run(sender.engine.connectionLost());
    receiver.run(receiver.engine.connectionLost());
    expect(sender.engine.state).toBe("FAILED");
    expect(receiver.engine.state).toBe("FAILED");
    expect(sender.effects.cleanups).toBe(1);
    expect(receiver.effects.cleanups).toBe(1);
    // No reactivation afterwards.
    expect(sender.engine.recordBytes(1).ok).toBe(false);
  });

  it("begin stream effects are applied exactly once per side", () => {
    const { sender, receiver } = transferringPair();
    expect(sender.effects.begun).toBe(1);
    expect(receiver.effects.begun).toBe(1);
    expect(sender.effects.stopped).toBe(0);
    expect(receiver.effects.stopped).toBe(0);
  });
});

// ============================================================================
// Session integration: session guard + delivery engine cohesion
// ============================================================================

describe("phase 06 — session integration boundary", () => {
  it("a delivery request bound to another session is refused at the engine", () => {
    const fresh = new DeliveryEngine(SESSION_ID);
    const foreign = { ...REQUEST, session_id: "sess_OTHER" } as DeliveryRequest;
    const outcome = fresh.receiveIncomingRequest(foreign);
    expect(outcome.ok).toBe(false);
    expect(outcome.problem).toBe("REQUEST_MISMATCH");
    expect(fresh.state).toBe("SESSION_ESTABLISHED");
  });

  it("duplicate decisions on the wire are rejected without state corruption", () => {
    const { sender, receiver } = acceptedPair();
    expect(sender.engine.processResponse(acceptResponse()).ok).toBe(false);
    expect(receiver.engine.sendDecision("ACCEPT").ok).toBe(false);
    expect(sender.engine.state).toBe("ACCEPTED");
    expect(receiver.engine.state).toBe("ACCEPTED");
  });

  it("decisions are never coerced into other messages (Decision stays discriminated)", () => {
    const decisions: Decision[] = ["ACCEPT", "REJECT"];
    for (const decision of decisions) {
      const response: DeliveryResponse = { type: "delivery_response", request_id: REQUEST_ID, decision };
      expect(response).toMatchObject({ decision, type: "delivery_response" });
      const encoded = encodeJsonFrame(response);
      expect(encoded.ok).toBe(true);
    }
  });
});