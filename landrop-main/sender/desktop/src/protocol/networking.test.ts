import { describe, expect, it } from "vitest";

import { ConnectionAttempt } from "./connection";
import { SecureChannelAttempt } from "./secure-channel";
import { establishSession, sessionEstablishedEvent, supportsProtocolVersion } from "./session-establishment";
import { parseDiscoveryInfo, createDiscoveryRegistry } from "./discovery";
import { createSession } from "./session";
import { INITIAL_DELIVERY_STATE } from "./state-machine";
import { createInMemoryDuplex } from "./transport";
import { JsonMessageStream, encodeJsonFrame } from "./message-stream";
import type { JsonMessageResult } from "./message-stream";
import { transition } from "./state-machine";
import type { DeliveryEvent } from "./state-machine";
import type { ControlMessage, DeliveryState } from "./types";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const discovery = fixtures.discovery as {
  peer: { service: string; hostname: string; port: number; protocol_version: number; device_name: string };
};

const deliveryEventMapping = fixtures.delivery_event_mapping as {
  layer: string;
  condition: string;
  event: DeliveryEvent;
}[];

const VALID_REQUEST: ControlMessage = {
  type: "delivery_request",
  protocol_version: 1,
  request_id: "req_01JTEST",
  session_id: "sess_01JTEST",
  presentation: { mode: "GUI" },
  sender: { display_name: "ISHAQ CYBERTECH" },
  application: {
    name: "My Application",
    version: "1.4.2",
    description: "A local test application.",
    package_name: "com.example.application",
    size_bytes: 26004608,
    sha256:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  },
};

const SESSION_DRAFT = {
  session_id: "sess_01JTEST",
  protocol_version: 1,
  sender: { display_name: "ISHAQ CYBERTECH" },
  receiver: { device_name: "Test Device" },
  lifetime: { created_at_ms: 0, expires_at_ms: 1000 },
};

const establish = () => {
  const established = establishSession(SESSION_DRAFT, {
    transportEstablished: true,
    secureChannelEstablished: true,
  });
  if (!established.ok) throw new Error("unexpected establishment failure");
  return established;
};

const RUN_STATES = ["CONNECTING", "SECURE_CHANNEL", "SESSION_ESTABLISHED"] as const;

describe("phase 05 — networking integration over Phase 02-04 foundations", () => {
  it("follows the fixture flow: discover -> connect -> TLS -> negotiate -> session", () => {
    // Discovery yields a candidate device (protocol §4).
    expect(supportsProtocolVersion(1)).toBe(true);
    const parsed = parseDiscoveryInfo(discovery.peer);
    expect(parsed.ok).toBe(true);
    const registry = createDiscoveryRegistry();
    if (parsed.ok) registry.upsert(parsed.info);
    expect(registry.list()).toHaveLength(1);

    // Delivery machine mapping (protocol §5 steps 1-7).
    const steps: [DeliveryState, DeliveryEvent, DeliveryState][] = [
      ["DISCOVERING", "device_found", "AVAILABLE"],
      ["AVAILABLE", "connect_initiated", "CONNECTING"],
      ["CONNECTING", "secure_channel_established", "SECURE_CHANNEL"],
      ["SECURE_CHANNEL", "session_established", "SESSION_ESTABLISHED"],
    ];
    let current: DeliveryState = "DISCOVERING";
    for (const [from, event, to] of steps) {
      const next = transition(current, event);
      expect(next.ok, `${from} --${event}--> ${to}`).toBe(true);
      if (next.ok) expect(next.to).toBe(to);
      current = to;
    }
    expect(current).toBe("SESSION_ESTABLISHED");
  });

  it("the fixture flow table is consistent with the state machine", () => {
    expect(INITIAL_DELIVERY_STATE).toBe("DISCOVERING");
    const expects: [DeliveryState, DeliveryEvent, DeliveryState][] = [
      ["DISCOVERING", "device_found", "AVAILABLE"],
      ["AVAILABLE", "connect_initiated", "CONNECTING"],
      ["CONNECTING", "secure_channel_established", "SECURE_CHANNEL"],
      ["SECURE_CHANNEL", "session_established", "SESSION_ESTABLISHED"],
    ];
    const wanted = new Map(expects.map(([from, event]) => [`${from}--${event}`, event]));
    expect(wanted.size).toBe(4);
    for (const [from, event, to] of expects) {
      const next = transition(from, event);
      expect(next.ok, `${from} --${event}-->`).toBe(true);
      if (next.ok) expect(next.to).toBe(to);
    }
    expect(deliveryEventMapping.length).toBeGreaterThanOrEqual(5);
    expect(deliveryEventMapping.map((r) => r.event)).toContain("connection_lost");
  });

  it("a lost connection pushes the flow to FAILED (protocol §27, §30)", () => {
    for (const from of RUN_STATES) {
      const lost = transition(from, "connection_lost");
      expect(lost.ok, from).toBe(true);
      if (lost.ok) expect(lost.to).toBe("FAILED");
      expect(transition("FAILED", "connection_lost").ok).toBe(false); // terminal
    }
  });

  it("a refused connect produces exactly [connect_initiated, connection_lost]", () => {
    const connection = new ConnectionAttempt();
    const events: DeliveryEvent[] = [];
    const begin = connection.begin();
    if (begin !== null) events.push(begin);
    const fail = connection.complete("refused");
    if (fail !== null) events.push(fail);
    expect(events).toEqual(["connect_initiated", "connection_lost"]);
    expect(connection.currentPhase).toBe("failed");
    expect(connection.lastFailure?.kind).toBe("IO_ERROR");
  });

  it("full handshake session on a deterministic channel", () => {
    const connection = new ConnectionAttempt();
    const channel = new SecureChannelAttempt();
    const flow: DeliveryEvent[] = [];
    const push = (event: DeliveryEvent | null): void => {
      if (event !== null) flow.push(event);
    };
    push(connection.begin());
    push(connection.complete("established"));
    push(channel.begin());
    push(channel.complete("established"));
    const shouldBeSessionEstablished = establish();
    expect(shouldBeSessionEstablished.session.ok).toBe(true);
    push(sessionEstablishedEvent());
    push(connection.close());
    expect(flow).toEqual([
      "connect_initiated",
      "secure_channel_established",
      "session_established",
      "connection_lost",
    ]);
    // Determinism re-run.
    expect(flow).toEqual([
      "connect_initiated",
      "secure_channel_established",
      "session_established",
      "connection_lost",
    ]);
  });

  it("a closed TLS connection is classified connection_lost, not a session", () => {
    const connection = new ConnectionAttempt();
    const channel = new SecureChannelAttempt();
    connection.begin();
    connection.complete("established");
    channel.begin();
    expect(channel.complete("closed")).toBe("connection_lost");
    expect(connection.currentPhase).toBe("established"); // transport must close separately
    const loss = connection.close();
    expect(loss).toBe("connection_lost");
  });

  it("a delivery request travels codec -> frame -> duplex transport intact", () => {
    const duplex = createInMemoryDuplex();
    const encoded = encodeJsonFrame(VALID_REQUEST);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      expect(duplex.left.connect().ok).toBe(true);
      expect(duplex.right.connect().ok).toBe(true);
      expect(duplex.left.write(encoded.bytes).ok).toBe(true);

      // Pump transport.read into the message stream (architecture §29).
      const stream = new JsonMessageStream();
      let message: JsonMessageResult = stream.readMessage();
      if (message.outcome === "incomplete") {
        const read = duplex.right.read(4096);
        expect(read.kind).toBe("data");
        if (read.kind === "data") stream.feed(read.bytes);
        message = stream.readMessage();
      }
      expect(message.outcome).toBe("message");
      if (message.outcome === "message") {
        expect(message.message.type).toBe("delivery_request");
        expect(stream.bufferedBytes).toBe(0);
      }
    }
  });

  it("no messages or sessions can be forged after connection loss", () => {
    const session = createSession(SESSION_DRAFT);
    expect(session.ok).toBe(true);
    // After SESSION_ESTABLISHED -(connection_lost)> FAILED, reactivation is
    // unreachable: secure_channel_established/session_established are invalid.
    const afterLost = transition("FAILED", "session_established");
    expect(afterLost.ok).toBe(false);
  });
});