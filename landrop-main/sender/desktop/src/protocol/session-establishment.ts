// Session establishment boundary (protocol spec §5 steps 6-7, §7; project
// spec §15; architecture §28). Uses the Phase 04 Session foundation — no
// second session implementation and no invented handshake messages (the
// wire-level negotiation mechanism is a SPECIFICATION GAP; the only defined
// version is 1, so negotiation is a deterministic version gate).

import { CURRENT_PROTOCOL_VERSION } from "./types";
import type { DeliveryEvent } from "./state-machine";
import { createSession } from "./session";
import type { SessionCreateResult, SessionDraft } from "./session";

export const SESSION_ESTABLISHED_EVENT: DeliveryEvent = "session_established";

// Version negotiation. The protocol is locked at v1 (protocol spec §6);
// unsupported versions surface the existing UNSUPPORTED_PROTOCOL semantics
// via createSession. Non-integer inputs are unsupported, matching the codec.
export function supportsProtocolVersion(version: number): boolean {
  return version === CURRENT_PROTOCOL_VERSION;
}

export type SessionEstablishmentProblem =
  | "CONNECTION_NOT_ESTABLISHED"
  | "SECURE_CHANNEL_NOT_ESTABLISHED"
  | "SESSION_ISSUE";

export interface EstablishmentPrerequisites {
  readonly transportEstablished: boolean;
  readonly secureChannelEstablished: boolean;
}

export type SessionEstablishmentResult =
  | { readonly ok: true; readonly session: SessionCreateResult & { readonly ok: true } }
  | { readonly ok: false; readonly problem: SessionEstablishmentProblem };

// A session may only be established on a validated connection: transport open,
// TLS 1.3 established, version supported, and the Phase 04 draft valid.
// Failure at any step leaves NO session and NO partial establishment (invalid
// handshake/session inputs never create a usable session).
export function establishSession(
  draft: SessionDraft,
  prerequisites: EstablishmentPrerequisites,
): SessionEstablishmentResult {
  if (!prerequisites.transportEstablished) {
    return { ok: false, problem: "CONNECTION_NOT_ESTABLISHED" };
  }
  if (!prerequisites.secureChannelEstablished) {
    return { ok: false, problem: "SECURE_CHANNEL_NOT_ESTABLISHED" };
  }
  if (!supportsProtocolVersion(draft.protocol_version)) {
    return { ok: false, problem: "SESSION_ISSUE" };
  }
  const created = createSession(draft);
  if (!created.ok) {
    return { ok: false, problem: "SESSION_ISSUE" };
  }
  return { ok: true, session: created };
}

// The delivery event that corresponds to a successful session establishment.
// Kept separate so networking never emits it without an explicit, valid
// establishment result.
export function sessionEstablishedEvent(): DeliveryEvent {
  return SESSION_ESTABLISHED_EVENT;
}