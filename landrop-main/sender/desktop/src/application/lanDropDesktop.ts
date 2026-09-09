// LanDrop Desktop application-layer seam (integration boundary between the
// protocol layer and the desktop host). Up to Phase 06 the application layer
// only exposed getInfo; this small orchestrator is the missing connection
// between the protocol subsystems (discovery registry, connection, secure
// channel, session establishment, delivery engine, message-stream) and the
// outside world.
//
// Design rules honored:
// - Transport-agnostic: this module talks to a host-provided Transport (the
//   abstract Phase 04 seam). Real sockets/TLS/mDNS are NOT this module's job;
//   they remain the documented platform seams (architecture §41).
// - No second state machine: the DeliveryEngine (frozen Phase 03 machine)
//   owns ALL delivery state. Connection/SecureChannel phases are the Phase
//   04/05 attempt objects, surfaced for observability; no new enum is fused
//   into the machine.
// - No node:crypto, no UI, no I/O beyond what the injected Transport does.
//   This file is renderer-safe.
// - No invented wire messages: everything sent goes through the engine's
//   send_message action and the existing JsonMessageStream.
//
// Recorded specification gaps (documented, not worked around):
// - transfer_id has no defined wire carrier (protocol §17-§19): the receiver
//   side assigns its own transfer id locally (see ReceiverCoordinator.kt).
// - The binary APK plane (protocol §17) has no byte-level framing markers.
//   This side writes raw artifact bytes after the transfer starts and the
//   engines count bytes; completion is byte-count based (declared size).
// - Verification / installation results have no wire feedback message, so the
//   Sender mirror reaches the same terminal states through the same
//   deterministic ops the Receiver applied (offline mirror semantics; a wire
//   result message belongs to a future phase only if the spec defines one).

import type { DeliveryRequest, DeliveryState } from "../protocol/types";
import type { SessionDraft } from "../protocol/session";
import { DeliveryEngine, deliveryOutcomeProblem, type DeliveryOutcome } from "../protocol/delivery";
import { ConnectionAttempt, type ConnectionOutcome } from "../protocol/connection";
import { SecureChannelAttempt, SECURE_CHANNEL_ESTABLISHED_EVENT, type SecureChannelOutcome } from "../protocol/secure-channel";
import { createDiscoveryRegistry, parseDiscoveryInfo, type DiscoveredDevice } from "../protocol/discovery";
import { establishSession } from "../protocol/session-establishment";
import { JsonMessageStream, encodeJsonFrame, type JsonMessageResult } from "../protocol/message-stream";
import type { Transport } from "../protocol/transport";

// Host integrations the desktop host decides (UI / platform seam). Nothing
// here mutates the delivery machine; these are observation points.
export interface LanDropDesktopHandlers {
  onStatus?(status: string): void;
  onProgress?(percent: number): void;
  onInstallerInvocation?(): void;
  onCleanup?(): void;
}

type LinkPhase = "idle" | "failed" | "established";

export class LanDropDesktopService {
  private readonly devices = createDiscoveryRegistry();
  private readonly stream = new JsonMessageStream();
  private engine: DeliveryEngine | null = null;
  private connection = new ConnectionAttempt();
  private secureChannel = new SecureChannelAttempt();
  private link: LinkPhase = "idle";

  constructor(
    private readonly transport: Transport,
    private readonly handlers: LanDropDesktopHandlers = {},
  ) {}

  // --- Discovery (informational only; does not authenticate, spec §4) --------

  get discoveredDevices(): readonly DiscoveredDevice[] {
    return this.devices.list();
  }

  /** Feed a raw mDNS/DNS-SD record from the platform discovery seam. */
  feedDiscoveryRecord(input: Record<string, unknown>): boolean {
    const parsed = parseDiscoveryInfo(input);
    if (!parsed.ok) {
      this.handlers.onStatus?.(`discovery rejected: ${parsed.problem}`);
      return false;
    }
    this.devices.upsert(parsed.info);
    this.handlers.onStatus?.("device_found");
    return true;
  }

  removeDevice(hostname: string, port: number): void {
    this.devices.remove(hostname, port);
  }

  // --- Connection + secure channel + session (spec §5-§7) --------------------

  /**
   * One deterministic attempt: transport -> TLS 1.3 -> session (spec §5).
   * outcome/secureOutcome are the platform seam's classifications; this seam
   * maps them through the Phase 04/05 attempt objects and Phase 04 session
   * mechanism, emitting connect_initiated/secure_channel_established/
   * session_established exactly once on the success path.
   */
  connect(
    outcome: ConnectionOutcome,
    secureOutcome: SecureChannelOutcome,
    draft: SessionDraft,
  ): boolean {
    if (this.link !== "idle") return false;
    this.connection.begin();
    this.handlers.onStatus?.("connect_initiated");

    // The host transport must actually be open before a TLS handshake can run.
    if (!this.transport.connect().ok) {
      this.link = "failed";
      this.connection.complete("io_error");
      this.handlers.onStatus?.("connection_lost (transport)");
      return false;
    }
    if (this.connection.complete(outcome) !== null) {
      this.link = "failed";
      this.handlers.onStatus?.(
        `connection_lost (${this.connection.lastFailure?.message ?? "refused"})`,
      );
      return false;
    }

    this.secureChannel.begin();
    // SecureChannelAttempt.complete returns the *event* on success
    // ("secure_channel_established"), unlike ConnectionAttempt which returns
    // null success. Treat the established event as the success signal.
    if (this.secureChannel.complete(secureOutcome) !== SECURE_CHANNEL_ESTABLISHED_EVENT) {
      this.link = "failed";
      this.handlers.onStatus?.("connection_lost (TLS)");
      return false;
    }
    this.handlers.onStatus?.("secure_channel_established");

    const established = establishSession(draft, {
      transportEstablished: true,
      secureChannelEstablished: true,
    });
    if (!established.ok) {
      this.link = "failed";
      this.handlers.onStatus?.("session establishment failed");
      return false;
    }
    this.engine = new DeliveryEngine(established.session.session.session_id);
    this.link = "established";
    this.handlers.onStatus?.("session_established");
    return true;
  }

  // --- Delivery (spec §8-§15) -------------------------------------------------

  sendDeliveryRequest(request: DeliveryRequest): DeliveryOutcome {
    if (this.engine === null || this.link !== "established") {
      return deliveryOutcomeProblem("INVALID_STATE");
    }
    const sent = this.engine.registerDeliveryRequest(request);
    if (!sent.ok) return sent;
    this.write(sent);
    const awaited = this.engine.awaitDecision();
    if (awaited.ok) this.handlers.onStatus?.("waiting_for_decision");
    return awaited;
  }

  /** Drain inbound bytes and dispatch any complete control messages. */
  onInbound(): void {
    this.pump();
    for (;;) {
      const result = this.stream.readMessage();
      if (result.outcome === "incomplete") return;
      if (result.outcome === "frame-error") {
        this.handlers.onStatus?.("protocol error: bad frame");
        return;
      }
      if (result.outcome === "protocol-error") {
        this.handlers.onStatus?.("protocol error: invalid message");
        return;
      }
      if (result.outcome === "end") return;
      this.dispatch(result);
    }
  }

  // --- Transfer (spec §16-§19) --------------------------------------------------

  /**
   * Stream the artifact as raw bytes (spec §17 binary plane). Returns true when
   * the Sender's copy of the engine reaches VERIFYING.
   */
  runTransfer(transferId: string, bytes: Iterable<Uint8Array>): boolean {
    if (this.engine === null || this.link !== "established") return false;
    if (!this.engine.prepareTransfer().ok) return false;
    if (!this.engine.beginTransfer(transferId).ok) return false;
    this.handlers.onStatus?.("transferring");
    let total = 0;
    for (const chunk of bytes) {
      if (chunk.length > 0) {
        const written = this.transport.write(chunk);
        if (!written.ok) return false;
        total += chunk.length;
      }
    }
    if (total !== this.engine.declaredSize) return false;
    if (!this.engine.recordBytes(total).ok) return false;
    const finished = this.engine.completeTransfer();
    if (finished.ok) {
      this.handlers.onStatus?.("verifying");
      this.handlers.onProgress?.(this.engine.progressPercent);
    }
    return finished.ok;
  }

  /** Sender-side cancellation: engine cleanup + transfer_cancel on the wire. */
  cancelTransfer(): DeliveryOutcome {
    if (this.engine === null) return deliveryOutcomeProblem("INVALID_STATE");
    const outcome = this.engine.cancel();
    if (outcome.ok && this.engine.transferId !== null) {
      const encoded = encodeJsonFrame({
        type: "transfer_cancel",
        transfer_id: this.engine.transferId,
      });
      if (encoded.ok) this.transport.write(encoded.bytes);
      this.handlers.onStatus?.("cancelled");
    }
    return outcome;
  }

  /**
   * Transport loss reported by the host (spec §27): routed through the engine's
   * connection_lost op, which emits cleanup for pre-terminal states.
   */
  handleConnectionLoss(): DeliveryOutcome {
    if (this.engine === null) return deliveryOutcomeProblem("INVALID_STATE");
    const outcome = this.engine.connectionLost();
    if (outcome.ok) {
      this.handlers.onStatus?.("connection_lost");
      this.handlers.onCleanup?.();
      this.link = "failed";
    }
    return outcome;
  }

  /**
   * Sender mirror of a Receiver-side verification/installation result. There is
   * no wire feedback message (recorded specification gap), so the Sender's copy
   * of the machine is completed with the same deterministic outcomes the
   * Receiver applied. actualDigest must be the SHA-256 computed over the
   * artifact bytes (lowercase hex).
   */
  mirrorInstallProgress(actualDigest: string, installerCompleted: boolean): void {
    if (this.engine === null) return;
    const verified = this.engine.completeVerification(actualDigest);
    if (!verified.ok || verified.problem === "INTEGRITY_MISMATCH") {
      this.handlers.onStatus?.("integrity_mismatch");
      this.handlers.onCleanup?.();
      return;
    }
    this.handlers.onStatus?.("verified");
    if (installerCompleted && this.engine.prepareInstall().ok) {
      if (this.engine.handoffInstall().ok) this.handlers.onInstallerInvocation?.();
      if (this.engine.installationCompleted().ok) {
        this.handlers.onStatus?.("completed");
        this.handlers.onCleanup?.();
      }
    }
  }

  get sessionState(): DeliveryState | null {
    return this.engine?.state ?? null;
  }

  // --- Internals ---------------------------------------------------------------

  private write(outcome: DeliveryOutcome): void {
    if (outcome.action.kind === "send_message") {
      const encoded = encodeJsonFrame(outcome.action.message);
      if (encoded.ok) this.transport.write(encoded.bytes);
    }
  }

  private dispatch(result: JsonMessageResult): void {
    if (result.outcome !== "message") return;
    const message = result.message;
    if (message.type === "delivery_response" && this.engine !== null) {
      const outcome = this.engine.processResponse(message);
      if (outcome.ok) {
        this.handlers.onStatus?.(
          message.decision === "ACCEPT" ? "accepted" : "rejected",
        );
      }
    }
  }

  private pump(): void {
    for (let i = 0; i < 32; i++) {
      const read = this.transport.read(4096);
      if (read.kind === "data" && read.bytes.length > 0) {
        this.stream.feed(read.bytes);
      } else {
        return;
      }
    }
  }
}