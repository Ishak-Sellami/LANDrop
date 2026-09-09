// Session model helpers (protocol spec §7, project spec §17). Deterministic
// expiration and creation rules over the Phase 02 SessionData/Lifetime types.
// No session-state machine is invented here; the delivery machine owns state.

import { isValidProtocolId } from "./codec";
import { CURRENT_PROTOCOL_VERSION } from "./types";
import type { DeviceInfo, DeliveryState, Lifetime, SenderProfile, SessionData } from "./types";

export type SessionStatus = "not_started" | "active" | "expired";

function lifetimeOf(session: Pick<SessionData, "lifetime">): Lifetime {
  return session.lifetime;
}

// A session is active iff its time window [created_at_ms, expires_at_ms) has
// been entered and has not yet ended. now==expires_at_ms is expired.
export function sessionStatus(session: Pick<SessionData, "lifetime">, nowMs: number): SessionStatus {
  const { created_at_ms, expires_at_ms } = lifetimeOf(session);
  if (nowMs < created_at_ms) return "not_started";
  if (nowMs >= expires_at_ms) return "expired";
  return "active";
}

export function isSessionActive(session: Pick<SessionData, "lifetime">, nowMs: number): boolean {
  return sessionStatus(session, nowMs) === "active";
}

export function isSessionExpired(session: Pick<SessionData, "lifetime">, nowMs: number): boolean {
  return sessionStatus(session, nowMs) === "expired";
}

export type SessionProblem =
  | "INVALID_SESSION_ID"
  | "UNSUPPORTED_PROTOCOL"
  | "INVALID_LIFETIME";

export interface SessionDraft {
  readonly session_id: string;
  readonly protocol_version: number;
  readonly sender: SenderProfile;
  readonly receiver: DeviceInfo;
  readonly lifetime: Lifetime;
}

export type SessionCreateResult =
  | { readonly ok: true; readonly session: SessionData }
  | { readonly ok: false; readonly problem: SessionProblem };

// Creates a session in the initial delivery state. Uniform messages
// (presentation text / notification) are not part of the session; they arrive
// with each delivery request.
export function createSession(draft: SessionDraft): SessionCreateResult {
  if (!isValidProtocolId(draft.session_id)) {
    return { ok: false, problem: "INVALID_SESSION_ID" };
  }
  if (draft.protocol_version !== CURRENT_PROTOCOL_VERSION) {
    return { ok: false, problem: "UNSUPPORTED_PROTOCOL" };
  }
  const { created_at_ms, expires_at_ms } = draft.lifetime;
  if (
    !Number.isSafeInteger(created_at_ms) ||
    !Number.isSafeInteger(expires_at_ms) ||
    created_at_ms < 0 ||
    expires_at_ms <= created_at_ms
  ) {
    return { ok: false, problem: "INVALID_LIFETIME" };
  }
  const session: SessionData = {
    session_id: draft.session_id,
    protocol_version: draft.protocol_version,
    sender: draft.sender,
    receiver: draft.receiver,
    state: "DISCOVERING" as DeliveryState,
    lifetime: draft.lifetime,
  };
  return { ok: true, session };
}