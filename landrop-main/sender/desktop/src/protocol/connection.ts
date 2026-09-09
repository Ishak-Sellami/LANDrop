// Connection lifecycle foundation (protocol spec §5, project spec §15,
// architecture §28/§29/§31). ONE deterministic connection attempt per
// lifecycle; no automatic reconnection, pooling, load balancing, NAT
// traversal, or proxying. The platform seam maps socket outcomes into
// ConnectionOutcome; this module maps them into Phase 04 TransportFailure and
// the existing DeliveryEvents. Networking layers only ever emit the events the
// Phase 03 machine already defines.

import type { DeliveryEvent } from "./state-machine";
import type { TransportErrorKind, TransportFailure } from "./transport";

export type ConnectionOutcome =
  | "established"
  | "refused"
  | "timeout"
  | "closed"
  | "io_error";

export const CONNECTION_OUTCOMES: readonly ConnectionOutcome[] = [
  "established",
  "refused",
  "timeout",
  "closed",
  "io_error",
];

export type ConnectionPhase = "idle" | "connecting" | "established" | "failed" | "closed";

export const CONNECTION_BEGIN_EVENT: DeliveryEvent = "connect_initiated";
export const CONNECTION_LOST_EVENT: DeliveryEvent = "connection_lost";

// Fixture-driven failure mapping (protocol spec §27 CONNECTION_LOST,
// architecture §31 transport errors). No new wire ErrorCodes.
const CONNECTION_FAILURE_KINDS: Readonly<
  Record<Exclude<ConnectionOutcome, "established">, TransportErrorKind>
> = {
  refused: "IO_ERROR",
  timeout: "TIMEOUT",
  closed: "CONNECTION_LOST",
  io_error: "IO_ERROR",
};

const CONNECTION_FAILURE_MESSAGES: Readonly<
  Record<Exclude<ConnectionOutcome, "established">, string>
> = {
  refused: "connection refused",
  timeout: "connection timed out",
  closed: "connection closed",
  io_error: "transport I/O error",
};

export function connectionFailure(outcome: Exclude<ConnectionOutcome, "established">): TransportFailure {
  return { kind: CONNECTION_FAILURE_KINDS[outcome], message: CONNECTION_FAILURE_MESSAGES[outcome] };
}

export interface ConnectionAttemptEvents {
  readonly events: readonly DeliveryEvent[];
}

// Deterministic single-attempt connection lifecycle.
// - begin(): idle -> connecting, emits connect_initiated.
// - complete(outcome): connecting -> established (null event) or -> failed
//   (emits connection_lost once). Completed attempts are finalized: repeated
//   complete() is a no-op.
// - close(): connecting|established -> closed, emits connection_lost once;
//   idempotent from any terminal phase (architecture §31, fixture close case).
export class ConnectionAttempt {
  private phase: ConnectionPhase = "idle";
  private readonly emitted: DeliveryEvent[] = [];
  private failure: TransportFailure | null = null;

  get currentPhase(): ConnectionPhase {
    return this.phase;
  }

  get lastFailure(): TransportFailure | null {
    return this.failure;
  }

  begin(): DeliveryEvent | null {
    if (this.phase !== "idle") return null;
    this.phase = "connecting";
    this.emitted.push(CONNECTION_BEGIN_EVENT);
    return CONNECTION_BEGIN_EVENT;
  }

  complete(outcome: ConnectionOutcome): DeliveryEvent | null {
    if (this.phase === "established" || this.phase === "failed" || this.phase === "closed") {
      return null;
    }
    if (this.phase !== "connecting") return null;
    if (outcome === "established") {
      this.phase = "established";
      return null;
    }
    this.phase = "failed";
    this.failure = connectionFailure(outcome);
    this.emitted.push(CONNECTION_LOST_EVENT);
    return CONNECTION_LOST_EVENT;
  }

  close(): DeliveryEvent | null {
    if (this.phase === "failed" || this.phase === "closed") return null;
    if (this.phase !== "connecting" && this.phase !== "established") return null;
    this.phase = "closed";
    this.emitted.push(CONNECTION_LOST_EVENT);
    return CONNECTION_LOST_EVENT;
  }

  events(): ConnectionAttemptEvents {
    return { events: this.emitted };
  }
}