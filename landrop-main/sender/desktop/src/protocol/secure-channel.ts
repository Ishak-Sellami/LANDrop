// Secure-channel (TLS) lifecycle foundation (protocol spec §3/§5, project
// spec §15, architecture §28/§31). TLS 1.3 is implemented by the platform
// runtime only — no custom cryptography, no invented certificate model. The
// certificate/trust policy for LanDrop peers is a SPECIFICATION GAP (protocol
// §39 defers pairing/trust); validation failure therefore surfaces the
// platform default result and is never silently weakened. This module is
// deterministic and I/O-free: it classifies platform handshake outcomes into
// transport failures and the existing DeliveryEvents.

import type { DeliveryEvent } from "./state-machine";
import type { TransportFailure } from "./transport";

export type SecureChannelOutcome =
  | "established"
  | "handshake_failure"
  | "validation_failure"
  | "timeout"
  | "closed";

export const SECURE_CHANNEL_OUTCOMES: readonly SecureChannelOutcome[] = [
  "established",
  "handshake_failure",
  "validation_failure",
  "timeout",
  "closed",
];

export type SecureChannelPhase = "idle" | "tls" | "established" | "failed" | "closed";

export const SECURE_CHANNEL_ESTABLISHED_EVENT: DeliveryEvent = "secure_channel_established";
export const CONNECTION_LOST_EVENT: DeliveryEvent = "connection_lost";

const SECURE_CHANNEL_FAILURE_KINDS: Readonly<
  Record<Exclude<SecureChannelOutcome, "established">, TransportFailure["kind"]>
> = {
  handshake_failure: "IO_ERROR",
  validation_failure: "IO_ERROR",
  timeout: "TIMEOUT",
  closed: "CONNECTION_LOST",
};

const SECURE_CHANNEL_FAILURE_MESSAGES: Readonly<
  Record<Exclude<SecureChannelOutcome, "established">, string>
> = {
  handshake_failure: "TLS handshake failed",
  validation_failure: "certificate validation failed (trust model undefined)",
  timeout: "TLS handshake timed out",
  closed: "connection closed during TLS handshake",
};

export function secureChannelFailure(
  outcome: Exclude<SecureChannelOutcome, "established">,
): TransportFailure {
  return {
    kind: SECURE_CHANNEL_FAILURE_KINDS[outcome],
    message: SECURE_CHANNEL_FAILURE_MESSAGES[outcome],
  };
}

// Deterministic TLS-handshake lifecycle over an already-open transport.
// - begin(): idle -> tls. No delivery event is emitted: the Phase 03 machine
//   stays in CONNECTING while the handshake runs.
// - complete(outcome): established -> emits secure_channel_established;
//   any failure -> emits connection_lost once (deterministic failure
//   propagation). Repeated completion is a no-op.
// - close(): aborts a running handshake -> connection_lost once; idempotent.
export class SecureChannelAttempt {
  private phase: SecureChannelPhase = "idle";
  private readonly emitted: DeliveryEvent[] = [];
  private failure: TransportFailure | null = null;

  get currentPhase(): SecureChannelPhase {
    return this.phase;
  }

  get lastFailure(): TransportFailure | null {
    return this.failure;
  }

  begin(): null {
    if (this.phase === "idle") this.phase = "tls";
    return null;
  }

  complete(outcome: SecureChannelOutcome): DeliveryEvent | null {
    if (this.phase === "established" || this.phase === "failed" || this.phase === "closed") {
      return null;
    }
    if (this.phase !== "tls") return null;
    if (outcome === "established") {
      this.phase = "established";
      this.emitted.push(SECURE_CHANNEL_ESTABLISHED_EVENT);
      return SECURE_CHANNEL_ESTABLISHED_EVENT;
    }
    this.phase = "failed";
    this.failure = secureChannelFailure(outcome);
    this.emitted.push(CONNECTION_LOST_EVENT);
    return CONNECTION_LOST_EVENT;
  }

  close(): DeliveryEvent | null {
    if (this.phase === "failed" || this.phase === "closed") return null;
    if (this.phase !== "tls") return null;
    this.phase = "closed";
    this.emitted.push(CONNECTION_LOST_EVENT);
    return CONNECTION_LOST_EVENT;
  }

  events(): readonly DeliveryEvent[] {
    return this.emitted;
  }
}