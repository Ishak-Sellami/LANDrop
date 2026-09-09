// Delivery Engine — deterministic delivery-request, transfer-flow, integrity-
// verification, and installation-handoff orchestration (protocol spec §8-§26,
// project spec §12-§19, architecture §18, §21). Pure decision logic only:
// validates input, checks the frozen Phase 03 Delivery State Machine, computes
// the event + next state, and emits a side-effect instruction. It performs NO
// I/O, no storage, no hashing, and no installation work (protocol §20-§23 gate
// VERIFYING -> INSTALLATION_HANDOFF; the digest is computed by the platform
// seam and handed in, and the installer is invoked by the application layer).
//
// Mirrors the Rust implementation in src-tauri/src/protocol/delivery.rs and
// the Kotlin implementation in receiver/android/.../protocol/Delivery.kt.

import { isValidProtocolId } from "./codec";
import { hashesMatch, isValidSha256 } from "./integrity";
import type { ControlMessage, Decision, DeliveryRequest, DeliveryResponse, DeliveryState } from "./types";
import { isDeliveryTerminal, transition } from "./state-machine";
import type { DeliveryEvent } from "./state-machine";

// ---------------------------------------------------------------------------
// Delivery operation problems — local decision-layer diagnostics, never wire
// ErrorCodes (no new wire error codes are invented; existing Phase 02 codes
// already cover every delivery failure reachable in this phase).
// ---------------------------------------------------------------------------

export type DeliveryProblem =
  | "INVALID_STATE"
  | "INVALID_TRANSITION"
  | "NO_REQUEST"
  | "NO_TRANSFER"
  | "REQUEST_MISMATCH"
  | "RESPONSE_MISMATCH"
  | "TRANSFER_ID_MISMATCH"
  | "INVALID_TRANSFER_ID"
  | "INVALID_BYTES"
  | "SIZE_EXCEEDED"
  | "SIZE_MISMATCH"
  | "SIZE_VALIDATION_FAILED"
  | "INVALID_DIGEST"
  | "NO_DIGEST"
  | "INTEGRITY_MISMATCH";

// Side-effect instruction produced by the pure layer. The application layer
// (session/message-stream/transport) executes it; this module never does.
export type DeliveryAction =
  | { readonly kind: "none" }
  | { readonly kind: "send_message"; readonly message: ControlMessage }
  | { readonly kind: "begin_stream" }
  | { readonly kind: "stop_stream" }
  | { readonly kind: "invoke_installer" }
  | { readonly kind: "cleanup" };

export interface DeliveryOutcome {
  readonly ok: boolean;
  readonly event: DeliveryEvent | null;
  readonly to: DeliveryState | null;
  readonly action: DeliveryAction;
  readonly problem: DeliveryProblem | null;
}

// Pure helpers ---------------------------------------------------------------

export function decisionEvent(decision: Decision): DeliveryEvent {
  return decision === "ACCEPT" ? "accepted" : "rejected";
}

export function createDeliveryResponse(
  requestId: string,
  decision: Decision,
): DeliveryResponse {
  return { type: "delivery_response", request_id: requestId, decision };
}

// Clamped percentage (0..100). Progress is observation, not a Delivery State
// (protocol spec §31-§33): the machine stays in TRANSFERRING.
export function calculateTransferProgress(
  bytesTransferred: number,
  totalBytes: number,
): number {
  if (totalBytes <= 0) return 0;
  const fraction = bytesTransferred / totalBytes;
  return Math.max(0, Math.min(100, Math.floor(fraction * 100)));
}

export function deliveryOutcomeProblem(
  problem: DeliveryProblem,
): DeliveryOutcome {
  return { ok: false, event: null, to: null, action: { kind: "none" }, problem };
}

// ---------------------------------------------------------------------------
// DeliveryEngine
// ---------------------------------------------------------------------------

export class DeliveryEngine {
  private _state: DeliveryState;
  private _request: DeliveryRequest | null = null;
  private _transferId: string | null = null;
  private _bytesTransferred = 0;

  constructor(
    private readonly _sessionId: string,
    initialState: DeliveryState = "SESSION_ESTABLISHED",
  ) {
    this._state = initialState;
  }

  get state(): DeliveryState {
    return this._state;
  }

  get request(): DeliveryRequest | null {
    return this._request;
  }

  get transferId(): string | null {
    return this._transferId;
  }

  get declaredSize(): number {
    return this._request?.application.size_bytes ?? 0;
  }

  // Expected digest the Sender declared in the delivery request (project spec
  // §14). The receiver verifies its independently computed digest against it.
  get expectedDigest(): string | null {
    return this._request?.application.sha256 ?? null;
  }

  get bytesTransferred(): number {
    return this._bytesTransferred;
  }

  get progressPercent(): number {
    return calculateTransferProgress(this._bytesTransferred, this.declaredSize);
  }

  // Compute event + next state through the frozen machine; apply iff valid.
  private apply(event: DeliveryEvent, requestedState: DeliveryState): DeliveryOutcome {
    if (this._state !== requestedState) {
      return deliveryOutcomeProblem("INVALID_STATE");
    }
    const result = transition(this._state, event);
    if (!result.ok) {
      return deliveryOutcomeProblem("INVALID_TRANSITION");
    }
    this._state = result.to;
    return {
      ok: true,
      event,
      to: result.to,
      action: { kind: "none" },
      problem: null,
    };
  }

  private requireNoTerminal(): DeliveryProblem | null {
    return isDeliveryTerminal(this._state) ? "INVALID_STATE" : null;
  }

  private finish(inner: DeliveryOutcome, action: DeliveryAction): DeliveryOutcome {
    return { ...inner, action };
  }

  // --- Sender: register and send a delivery request (spec §8-§13) -------------

  registerDeliveryRequest(request: DeliveryRequest): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "SESSION_ESTABLISHED") return deliveryOutcomeProblem("INVALID_STATE");
    if (request.session_id !== this._sessionId) return deliveryOutcomeProblem("REQUEST_MISMATCH");
    this._request = request;
    this._bytesTransferred = 0;
    return this.finish(this.apply("request_sent", "SESSION_ESTABLISHED"), {
      kind: "send_message",
      message: request,
    });
  }

  // --- Sender: request is on the wire; wait for the Receiver decision ---------

  awaitDecision(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    return this.apply("awaiting_decision", "REQUEST_SENT");
  }

  // --- Receiver: validate an incoming delivery request (spec §35-§37) ---------

  receiveIncomingRequest(request: DeliveryRequest): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "SESSION_ESTABLISHED") return deliveryOutcomeProblem("INVALID_STATE");
    if (request.session_id !== this._sessionId) return deliveryOutcomeProblem("REQUEST_MISMATCH");
    this._request = request;
    this._bytesTransferred = 0;
    // Mirror of the Sender's machine advance: request present -> awaiting user.
    return this.finish(this.apply("request_sent", "SESSION_ESTABLISHED"), { kind: "none" });
  }

  // --- Receiver: send the decision (spec §10, §14-§15) ------------------------

  sendDecision(decision: Decision): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "WAITING_FOR_DECISION") return deliveryOutcomeProblem("INVALID_STATE");
    if (this._request === null) return deliveryOutcomeProblem("NO_REQUEST");
    const event: DeliveryEvent = decisionEvent(decision);
    const applied = this.apply(event, "WAITING_FOR_DECISION");
    if (!applied.ok) return applied;
    // Spec §14-§15: the Receiver sends delivery_response for BOTH decisions.
    return this.finish(applied, {
      kind: "send_message",
      message: createDeliveryResponse(this._request.request_id, decision),
    });
  }

  // --- Sender: process the Receiver's response --------------------------------

  processResponse(response: DeliveryResponse): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "WAITING_FOR_DECISION") return deliveryOutcomeProblem("INVALID_STATE");
    if (this._request === null) return deliveryOutcomeProblem("NO_REQUEST");
    if (response.request_id !== this._request.request_id) {
      return deliveryOutcomeProblem("RESPONSE_MISMATCH");
    }
    const applied = this.apply(decisionEvent(response.decision), "WAITING_FOR_DECISION");
    if (!applied.ok) return applied;
    return this.finish(applied, { kind: "none" });
  }

  // --- Expiration (spec §25; numeric timeout is a recorded specification gap) --

  expire(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    return this.finish(this.apply("expired", "WAITING_FOR_DECISION"), { kind: "cleanup" });
  }

  // --- Transfer preparation (spec §16) -----------------------------------------

  prepareTransfer(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "ACCEPTED") return deliveryOutcomeProblem("INVALID_STATE");
    const applied = this.apply("transfer_prepared", "ACCEPTED");
    if (!applied.ok) return applied;
    return this.finish(applied, { kind: "none" });
  }

  // --- Transfer start (spec §16-§17) -------------------------------------------

  beginTransfer(transferId: string): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "TRANSFER_PREPARING") return deliveryOutcomeProblem("INVALID_STATE");
    if (this._request === null) return deliveryOutcomeProblem("NO_REQUEST");
    if (!isValidProtocolId(transferId)) return deliveryOutcomeProblem("INVALID_TRANSFER_ID");
    const declared = this._request.application.size_bytes;
    if (!Number.isSafeInteger(declared) || declared <= 0) {
      return deliveryOutcomeProblem("SIZE_VALIDATION_FAILED");
    }
    this._transferId = transferId;
    this._bytesTransferred = 0;
    const applied = this.apply("transfer_started", "TRANSFER_PREPARING");
    if (!applied.ok) return applied;
    return this.finish(applied, { kind: "begin_stream" });
  }

  // --- Byte accounting (spec §18 receiver-side size enforcement) ----------------

  recordBytes(count: number): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "TRANSFERRING") return deliveryOutcomeProblem("INVALID_STATE");
    if (!Number.isSafeInteger(count) || count <= 0) return deliveryOutcomeProblem("INVALID_BYTES");
    const next = this._bytesTransferred + count;
    if (next > this.declaredSize) return deliveryOutcomeProblem("SIZE_EXCEEDED");
    this._bytesTransferred = next;
    return { ok: true, event: null, to: null, action: { kind: "none" }, problem: null };
  }

  // --- Transfer completion (spec §19-§20: stops at verification_initiated) -------

  completeTransfer(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "TRANSFERRING") return deliveryOutcomeProblem("INVALID_STATE");
    if (this._transferId === null) return deliveryOutcomeProblem("NO_TRANSFER");
    if (this._bytesTransferred !== this.declaredSize) {
      return deliveryOutcomeProblem("SIZE_MISMATCH");
    }
    const applied = this.apply("verification_initiated", "TRANSFERRING");
    if (!applied.ok) return applied;
    return this.finish(applied, { kind: "none" });
  }

  // --- Receiver: integrity verification (spec §20-§21) --------------------------
  // The application layer computes SHA-256 over the received artifact via the
  // platform seam and hands the lowercase-hex digest in. The engine classifies
  // it against the declared digest and routes through the frozen machine.

  completeVerification(actualDigest: string): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "VERIFYING") return deliveryOutcomeProblem("INVALID_STATE");
    if (this._request === null) return deliveryOutcomeProblem("NO_REQUEST");
    if (!isValidSha256(actualDigest)) return deliveryOutcomeProblem("INVALID_DIGEST");
    const expected = this._request.application.sha256;
    if (expected === "") return deliveryOutcomeProblem("NO_DIGEST");
    if (hashesMatch(expected, actualDigest)) {
      return this.finish(this.apply("verified", "VERIFYING"), { kind: "none" });
    }
    // Protocol §21: mismatch -> FAILED, installation blocked, cleanup.
    const mismatch = this.apply("integrity_mismatch", "VERIFYING");
    return {
      ...this.finish(mismatch, { kind: "cleanup" }),
      problem: "INTEGRITY_MISMATCH",
    };
  }

  // --- Receiver: installation handoff (spec §23, project spec §26) --------------

  prepareInstall(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "VERIFIED") return deliveryOutcomeProblem("INVALID_STATE");
    return this.finish(this.apply("install_prepared", "VERIFIED"), { kind: "none" });
  }

  // The application layer calls this immediately before invoking the platform
  // installer; the emitted instruction tells it exactly that.
  handoffInstall(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "INSTALL_READY") return deliveryOutcomeProblem("INVALID_STATE");
    return this.finish(this.apply("handoff_initiated", "INSTALL_READY"), {
      kind: "invoke_installer",
    });
  }

  // Called only when the platform's supported package-install mechanism has
  // genuinely reported completion. Nothing fabricates this result.
  installationCompleted(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "INSTALLATION_HANDOFF") return deliveryOutcomeProblem("INVALID_STATE");
    // Terminal state -> cleanup instruction (artifact/session lifecycle).
    return this.finish(this.apply("completed", "INSTALLATION_HANDOFF"), { kind: "cleanup" });
  }

  // Platform reports the package installer is unavailable, before or during
  // handoff (project spec §24 INSTALLATION_UNAVAILABLE).
  installationUnavailable(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "INSTALL_READY" && this._state !== "INSTALLATION_HANDOFF") {
      return deliveryOutcomeProblem("INVALID_STATE");
    }
    return this.finish(this.apply("installation_unavailable", this._state), {
      kind: "cleanup",
    });
  }

  // --- Cancellation (spec §24; machine-gated) ------------------------------------

  cancel(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    const applied = this.apply("cancelled", this._state);
    if (!applied.ok) return applied;
    return this.finish(applied, { kind: "cleanup" });
  }

  // --- Incoming transfer_cancel from the Sender (spec §24) ------------------------

  processTransferCancel(transferId: string): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._transferId === null) return deliveryOutcomeProblem("NO_TRANSFER");
    if (transferId !== this._transferId) return deliveryOutcomeProblem("TRANSFER_ID_MISMATCH");
    return this.finish(this.apply("cancelled", this._state), { kind: "stop_stream" });
  }

  // --- Transfer inactivity timeout (spec §26) --------------------------------------

  transferTimeout(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    if (this._state !== "TRANSFERRING") return deliveryOutcomeProblem("INVALID_STATE");
    return this.finish(this.apply("transfer_timed_out", "TRANSFERRING"), { kind: "cleanup" });
  }

  // --- Connection loss at any pre-terminal stage (spec §27) --------------------------

  connectionLost(): DeliveryOutcome {
    const terminal = this.requireNoTerminal();
    if (terminal !== null) return deliveryOutcomeProblem(terminal);
    return this.finish(this.apply("connection_lost", this._state), { kind: "cleanup" });
  }
}