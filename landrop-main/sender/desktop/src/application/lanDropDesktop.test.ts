import { describe, expect, it } from "vitest";

import { sha256Hex } from "./sha256Hash";
import { LanDropDesktopService } from "./lanDropDesktop";
import { DeliveryEngine, type DeliveryOutcome } from "../protocol/delivery";
import type { ControlMessage, Decision, DeliveryRequest, TransferCancel } from "../protocol/types";
import type { SessionDraft } from "../protocol/session";
import { JsonMessageStream, encodeJsonFrame } from "../protocol/message-stream";
import { createInMemoryDuplex, type DuplexTransport, type Transport } from "../protocol/transport";

// ---------------------------------------------------------------------------
// Phase 08 — Desktop (Sender application layer) <-> Android (Receiver) proof
// ---------------------------------------------------------------------------
//
// The Sender side is the real product seam `LanDropDesktopService`. The
// Receiver side is a deterministic harness peer that plays the role of the
// Android app layer (the ReceiverCoordinator.kt mirror implements the same
// receiver role; it is exact-ordered and unexecuted here). Real artifact
// bytes cross the in-memory duplex on the binary plane and SHA-256 is computed
// over them with the Node seam — nothing trusts the fixture digest.
//
// Scenario fixtures live in protocol/fixtures/model-cases.json -> "integration".
// Recorded spec gaps (not worked around): transfer_id has no wire carrier, so
// both harness peers are arranged with the same transfer id exactly as
// delivery-flow.test.ts does; binary framing has no markers, so the receiver
// switches to binary consumption after ACCEPT and counts bytes.

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

interface IntegrationScenario {
  name: string;
  description?: string;
  decision: "ACCEPT" | "REJECT";
  artifact?: { contents: string[]; chunk_sizes: number[] };
  declared_sha256?: string;
  tamper?: { corrupt_byte_at: number };
  cancel_after_bytes?: number;
  loss_after_bytes?: number;
  expectation: {
    sender_final_state: string;
    receiver_final_state: string;
    installer_invoked: boolean;
  };
}

const scenarios: IntegrationScenario[] = (fixtures.integration as {
  scenarios: IntegrationScenario[];
}).scenarios;

const SESSION_ID = "sess_08INTEG";
const REQUEST_ID = "req_08INTEG";
const TRANSFER_ID = "tr_08INTEG";

const DRAFT: SessionDraft = {
  session_id: SESSION_ID,
  protocol_version: 1,
  sender: { display_name: "ISHAQ CYBERTECH" },
  receiver: { device_name: "Android test receiver" },
  lifetime: { created_at_ms: 1_700_000_000_000, expires_at_ms: 1_700_003_599_999 },
};

function artifactBytes(scenario: IntegrationScenario): Uint8Array {
  const text = (scenario.artifact?.contents ?? []).join("");
  return new TextEncoder().encode(text);
}

function requestFor(artifact: Uint8Array, declaredSha256: string): DeliveryRequest {
  return {
    type: "delivery_request",
    protocol_version: 1,
    request_id: REQUEST_ID,
    session_id: SESSION_ID,
    presentation: { mode: "GUI" },
    sender: { display_name: "ISHAQ CYBERTECH" },
    application: {
      name: "IntegTest",
      version: "1.0.0",
      description: "Phase 08 integration scenario.",
      package_name: "com.example.integ",
      size_bytes: artifact.length,
      sha256: declaredSha256,
    },
  };
}

describe("phase 08 — fixture integration scenarios are deterministic", () => {
  it("declared digests match a fresh SHA-256 over the modeled artifact", async () => {
    for (const scenario of scenarios) {
      if (!scenario.artifact || !scenario.declared_sha256) continue;
      const bytes = artifactBytes(scenario);
      const chunked = scenario.artifact.chunk_sizes.reduce((a, b) => a + b, 0);
      expect(chunked).toBe(bytes.length);
      const digest = await sha256Hex([bytes]);
      expect(digest).toBe(scenario.declared_sha256);
    }
  });
});

// ---------------------------------------------------------------------------
// Receiver harness peer (Android role; same logic as ReceiverCoordinator.kt)
// ---------------------------------------------------------------------------

type InstallResult = "succeeded" | "unavailable";

interface ReceiverTrace {
  installed: number;
  cleanups: number;
  installResult: InstallResult;
}

class ReceiverHarnessPeer {
  readonly engine: DeliveryEngine;
  readonly received: ControlMessage[] = [];
  readonly observed: string[] = [];
  readonly trace: ReceiverTrace = { installed: 0, cleanups: 0, installResult: "succeeded" };
  readonly stream = new JsonMessageStream();

  constructor(
    readonly sessionId: string,
    readonly transport: Transport,
    readonly transferId: string,
    readonly declaredSha256: string,
  ) {
    this.engine = new DeliveryEngine(sessionId);
    this.observed.push(`session_established`);
  }

  /** Execute an engine instruction; asserts success and counts side effects. */
  run(outcome: DeliveryOutcome): DeliveryOutcome {
    expect(outcome.ok, `${outcome.problem ?? "failure"} at ${this.engine.state}`).toBe(true);
    if (outcome.action.kind === "begin_stream") this.observed.push("begin_stream");
    if (outcome.action.kind === "stop_stream") this.observed.push("stop_stream");
    if (outcome.action.kind === "invoke_installer") this.trace.installed += 1;
    if (outcome.action.kind === "cleanup") this.trace.cleanups += 1;
    return outcome;
  }

  /** Control plane: drain inbound frames and advance the machine. */
  pumpControl(): void {
    for (let i = 0; i < 64; i++) {
      const read = this.transport.read(4096);
      if (read.kind !== "data" || read.bytes.length === 0) return;
      this.stream.feed(read.bytes);
      for (;;) {
        const result = this.stream.readMessage();
        if (result.outcome === "incomplete") break;
        if (result.outcome !== "message") {
          throw new Error(`protocol error on receiver wire: ${result.outcome}`);
        }
        this.received.push(result.message);
        if (result.message.type === "delivery_request") {
          expect(
            this.run(this.engine.receiveIncomingRequest(result.message as DeliveryRequest)).ok,
          ).toBe(true);
          expect(this.run(this.engine.awaitDecision()).ok).toBe(true);
        } else if (result.message.type === "transfer_cancel") {
          const handled = this.engine.processTransferCancel(
            (result.message as TransferCancel).transfer_id,
          );
          expect(handled.ok).toBe(true);
          this.run(handled);
          this.observed.push("transfer_cancelled");
        }
        // transfer_progress is an observation frame (§31): ignored by the machine.
      }
    }
  }

  /** User consent callback; writes the delivery_response frame for ACCEPT/REJECT. */
  consent(decision: Decision): void {
    const sent = this.engine.sendDecision(decision);
    expect(sent.ok).toBe(true);
    if (sent.action.kind === "send_message") {
      this.run(sent);
      const encoded = encodeJsonFrame(sent.action.message);
      expect(encoded.ok).toBe(true);
      if (encoded.ok) {
        const written = this.transport.write(encoded.bytes);
        expect(written.ok).toBe(true);
      }
    }
  }

  /**
   * Binary plane: read until the declared size is reached, hash with the Node
   * seam, verify against the declared digest, then install. Returns null if the
   * connection ends first (connection-loss scenario).
   */
  async readAndVerify(onBytes?: (bytes: Uint8Array) => Uint8Array): Promise<Uint8Array | null> {
    const expected = this.engine.declaredSize;
    const parts: Uint8Array[] = [];
    let total = 0;
    while (total < expected) {
      const read = this.transport.read(4096);
      if (read.kind === "data") {
        parts.push(read.bytes);
        total += read.bytes.length;
      } else if (read.kind === "empty") {
        continue;
      } else {
        return null; // end-of-stream / error while bytes remain
      }
    }
    const artifact = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      artifact.set(part, offset);
      offset += part.length;
    }
    expect(offset).toBe(expected);

    // Byte accounting through the frozen machine (spec §18/§19/§20).
    expect(this.run(this.engine.prepareTransfer()).ok).toBe(true);
    expect(this.run(this.engine.beginTransfer(this.transferId)).ok).toBe(true);
    expect(this.run(this.engine.recordBytes(expected)).ok).toBe(true);
    expect(this.run(this.engine.completeTransfer()).ok).toBe(true);

    const forHashing = onBytes !== undefined ? onBytes(new Uint8Array(artifact)) : artifact;
    const digest = await sha256Hex([forHashing]);

    const verified = this.engine.completeVerification(digest);
    if (!verified.ok || verified.problem === "INTEGRITY_MISMATCH") {
      // spec §21: mismatch -> FAILED, installation blocked, cleanup emitted.
      this.observed.push("integrity_mismatch_install_blocked");
      this.run(verified);
      expect(this.engine.state).toBe("FAILED");
      return null;
    }
    this.run(verified);
    this.observed.push("verified");
    expect(this.run(this.engine.prepareInstall()).ok).toBe(true);
    // spec §23: handoff emits InvokeInstaller; the app layer runs the installer.
    this.run(this.engine.handoffInstall());
    if (this.trace.installResult === "unavailable") {
      expect(this.run(this.engine.installationUnavailable()).ok).toBe(true);
    } else {
      expect(this.run(this.engine.installationCompleted()).ok).toBe(true);
    }
    return artifact;
  }
}

interface SenderHarness {
  duplex: DuplexTransport;
  service: LanDropDesktopService;
  statuses: string[];
  installInvocations: number;
  cleanups: number;
}

function bootSender(): SenderHarness {
  const duplex = createInMemoryDuplex();
  expect(duplex.left.connect().ok).toBe(true);
  expect(duplex.right.connect().ok).toBe(true);
  const statuses: string[] = [];
  const harness: SenderHarness = {
    duplex,
    statuses,
    installInvocations: 0,
    cleanups: 0,
    service: new LanDropDesktopService(duplex.left, {
      onStatus: (status) => statuses.push(status),
      onInstallerInvocation: () => {
        harness.installInvocations += 1;
      },
      onCleanup: () => {
        harness.cleanups += 1;
      },
    }),
  };
  return harness;
}

function bootFullStack(scenario: IntegrationScenario): {
  harness: SenderHarness;
  receiver: ReceiverHarnessPeer;
} {
  const harness = bootSender();
  const receiver = new ReceiverHarnessPeer(
    SESSION_ID,
    harness.duplex.right,
    TRANSFER_ID,
    scenario.declared_sha256 ?? "",
  );
  const connected = harness.service.connect(
    "established",
    "established",
    DRAFT,
  );
  expect(connected).toBe(true);
  expect(harness.statuses).toContain("session_established");
  return { harness, receiver };
}

/** Send the artifact in the fixture's chunk sizes. */
function streamArtifact(
  service: LanDropDesktopService,
  chunkSizes: number[],
  bytes: Uint8Array,
): void {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of chunkSizes) {
    chunks.push(bytes.subarray(offset, offset + size));
    offset += size;
  }
  const ok = service.runTransfer(TRANSFER_ID, chunks);
  expect(ok).toBe(true);
}

describe("phase 08 — desktop <-> android integration (offline, real bytes)", () => {
  it("full lifecycle: request, ACCEPT, binary transfer, verify, install -> COMPLETED", async () => {
    const scenario = scenarios[0]!;
    const bytes = artifactBytes(scenario);
    const { harness, receiver } = bootFullStack(scenario);
    harness.service.feedDiscoveryRecord({
      service: "_lanDrop._tcp.local",
      protocol_version: 1,
      device_name: "Android Device",
      hostname: "phone.local",
      port: 45821,
    });
    expect(receiver.trace.installed).toBe(0);

    const sent = harness.service.sendDeliveryRequest(requestFor(bytes, scenario.declared_sha256!));
    expect(sent.ok).toBe(true);
    expect(harness.service.sessionState).toBe("WAITING_FOR_DECISION");

    receiver.pumpControl();
    expect(receiver.engine.state).toBe("WAITING_FOR_DECISION");

    receiver.consent("ACCEPT" as Decision);
    harness.service.onInbound();
    expect(harness.service.sessionState).toBe("ACCEPTED");
    expect(receiver.engine.state).toBe("ACCEPTED");

    streamArtifact(harness.service, scenario.artifact!.chunk_sizes, bytes);
    expect(harness.service.sessionState).toBe("VERIFYING");

    await receiver.readAndVerify();
    expect(receiver.engine.state).toBe("COMPLETED");
    harness.service.mirrorInstallProgress(scenario.declared_sha256!, true);
    expect(harness.service.sessionState).toBe("COMPLETED");

    expect(receiver.trace.installed).toBe(1);
    expect(harness.installInvocations).toBe(1);
    expect(harness.cleanups).toBe(1);
    expect(receiver.trace.cleanups).toBe(1);
    expect(harness.statuses).toEqual(
      expect.arrayContaining(["session_established", "waiting_for_decision", "accepted", "transferring", "verifying", "verified"]),
    );
    expect(receiver.observed).toEqual(
      expect.arrayContaining(["begin_stream", "verified"]),
    );
    const requests = receiver.received.filter((m) => m.type === "delivery_request");
    expect(requests).toHaveLength(1);
  });

  it("integrity mismatch on the wire blocks installation (spec §21)", async () => {
    const scenario = scenarios[1]!;
    const bytes = artifactBytes(scenario);
    const { harness, receiver } = bootFullStack(scenario);

    harness.service.sendDeliveryRequest(requestFor(bytes, scenario.declared_sha256!));
    receiver.pumpControl();
    receiver.consent("ACCEPT");
    harness.service.onInbound();
    streamArtifact(harness.service, scenario.artifact!.chunk_sizes, bytes);

    const artifact = await receiver.readAndVerify((tampered) => {
      const at = scenario.tamper!.corrupt_byte_at;
      tampered[at] = 0xff ^ (tampered[at] ?? 0);
      return tampered;
    });
    expect(artifact).toBeNull();
    expect(receiver.engine.state).toBe("FAILED");
    expect(receiver.trace.installed).toBe(0);
    expect(receiver.observed).toContain("integrity_mismatch_install_blocked");
    // Cleanup is emitted by the mismatch op; nothing proceeds to install.
    expect(receiver.trace.cleanups).toBe(1);

    harness.service.mirrorInstallProgress(
      await sha256Hex([tampered(bytes, scenario.tamper!.corrupt_byte_at)]),
      false,
    );
    expect(harness.service.sessionState).toBe("FAILED");
    expect(harness.installInvocations).toBe(0);
  });

  it("REJECT travels receiver -> sender and no transfer starts", async () => {
    const scenario = scenarios[2]!;
    const { harness, receiver } = bootFullStack(scenario);

    harness.service.sendDeliveryRequest(requestFor(new Uint8Array(1), "00".repeat(32)));
    receiver.pumpControl();
    receiver.consent("REJECT");
    harness.service.onInbound();

    expect(receiver.engine.state).toBe("REJECTED");
    expect(harness.service.sessionState).toBe("REJECTED");
    expect(receiver.trace.installed).toBe(0);
    expect(harness.installInvocations).toBe(0);
    expect(harness.statuses).toContain("rejected");
  });
});

function tampered(bytes: Uint8Array, at: number): Uint8Array {
  const copy = new Uint8Array(bytes);
  copy[at] = 0xff ^ (copy[at] ?? 0);
  return copy;
}

describe("phase 08 — sender cancellation, connection loss, terminal safety", () => {
  it("sender cancellation mid-transfer: Sender CANCELLED, Receiver aborts (framing gap)", async () => {
    const scenario = scenarios[3]!;
    const bytes = artifactBytes(scenario);
    const { harness, receiver } = bootFullStack(scenario);

    harness.service.sendDeliveryRequest(requestFor(bytes, scenario.declared_sha256!));
    receiver.pumpControl();
    receiver.consent("ACCEPT");
    harness.service.onInbound();

    // Send only part of the artifact, then the user cancels on the Sender.
    const partial = bytes.subarray(0, scenario.cancel_after_bytes!);
    expect(harness.service.runTransfer(TRANSFER_ID, [partial])).toBe(false);

    const cancelled = harness.service.cancelTransfer();
    expect(cancelled.ok).toBe(true);
    expect(cancelled.action.kind).toBe("cleanup");
    expect(harness.service.sessionState).toBe("CANCELLED");
    expect(harness.statuses).toContain("cancelled");

    // The transfer_cancel frame the Sender wrote cannot be demuxed out of the
    // artifact stream (binary plane has no framing markers — recorded spec
    // gap): the Receiver's inbound now holds 63 raw bytes (6 artifact bytes +
    // the 57-byte cancel frame) against 11 declared, which is un-decidable
    // without an invented framing marker. The Receiver's host reports the
    // aborted transfer and both peers stop.
    harness.duplex.left.close();
    receiver.run(receiver.engine.connectionLost());
    expect(receiver.engine.state).toBe("FAILED");
    expect(receiver.observed).not.toContain("transfer_cancelled");
    expect(receiver.trace.installed).toBe(0);
    expect(harness.installInvocations).toBe(0);
  });

  it("connection loss mid-transfer routes both peers to FAILED (spec §27)", async () => {
    const scenario = scenarios[4]!;
    const bytes = artifactBytes(scenario);
    const { harness, receiver } = bootFullStack(scenario);

    harness.service.sendDeliveryRequest(requestFor(bytes, scenario.declared_sha256!));
    receiver.pumpControl();
    receiver.consent("ACCEPT");
    harness.service.onInbound();
    // Stream only part of the artifact, then the transport dies.
    const partial = bytes.subarray(0, scenario.loss_after_bytes!);
    expect(harness.service.runTransfer(TRANSFER_ID, [partial])).toBe(false);

    harness.duplex.left.close();
    const artifact = await receiver.readAndVerify();
    expect(artifact).toBeNull();
    receiver.run(receiver.engine.connectionLost());
    expect(receiver.engine.state).toBe("FAILED");

    harness.service.handleConnectionLoss();
    expect(harness.service.sessionState).toBe("FAILED");
    expect(receiver.trace.installed).toBe(0);
    expect(harness.installInvocations).toBe(0);
  });

  it("duplicate install handoff after completion is rejected (no double install)", async () => {
    const scenario = scenarios[0]!;
    const bytes = artifactBytes(scenario);
    const { harness, receiver } = bootFullStack(scenario);

    harness.service.sendDeliveryRequest(requestFor(bytes, scenario.declared_sha256!));
    receiver.pumpControl();
    receiver.consent("ACCEPT");
    harness.service.onInbound();
    streamArtifact(harness.service, scenario.artifact!.chunk_sizes, bytes);
    await receiver.readAndVerify();

    const dup = receiver.engine.prepareInstall();
    expect(dup.ok).toBe(false);
    expect(dup.problem).toBe("INVALID_STATE");
    expect(receiver.trace.installed).toBe(1);
    expect(receiver.engine.state).toBe("COMPLETED");
  });

  it("connect() is single-shot; refused transport reports connection_lost", () => {
    const harness = bootSender();
    expect(harness.service.connect("established", "established", DRAFT)).toBe(true);
    expect(harness.service.connect("established", "established", DRAFT)).toBe(false);
    expect(harness.statuses).toContain("session_established");

    const refused = bootSender();
    const ok = refused.service.connect("refused", "established", DRAFT);
    expect(ok).toBe(false);
    expect(refused.statuses.some((s) => s.startsWith("connection_lost"))).toBe(true);
  });

  it("discovery feeds are deduplicated by endpoint", () => {
    const harness = bootSender();
    const record = {
      service: "_lanDrop._tcp.local",
      protocol_version: 1,
      device_name: "Android Device",
      hostname: "phone.local",
      port: 45821,
    };
    expect(harness.service.feedDiscoveryRecord(record)).toBe(true);
    expect(harness.service.feedDiscoveryRecord(record)).toBe(true);
    expect(harness.service.discoveredDevices).toHaveLength(1);
    harness.service.removeDevice("phone.local", 45821);
    expect(harness.service.discoveredDevices).toHaveLength(0);
  });
});