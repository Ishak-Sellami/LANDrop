// Protocol v1 domain types — wire-compatible with the Rust implementation.
// No UI, no I/O, no state transitions.

export const CURRENT_PROTOCOL_VERSION = 1;

export type PresentationMode = "GUI" | "NOTIFICATION";

export type Decision = "ACCEPT" | "REJECT";

export type DeliveryState =
  | "DISCOVERING"
  | "AVAILABLE"
  | "CONNECTING"
  | "SECURE_CHANNEL"
  | "SESSION_ESTABLISHED"
  | "REQUEST_SENT"
  | "WAITING_FOR_DECISION"
  | "ACCEPTED"
  | "TRANSFER_PREPARING"
  | "TRANSFERRING"
  | "VERIFYING"
  | "VERIFIED"
  | "INSTALL_READY"
  | "INSTALLATION_HANDOFF"
  | "COMPLETED"
  | "REJECTED"
  | "FAILED"
  | "CANCELLED";

export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNSUPPORTED_PROTOCOL"
  | "REQUEST_EXPIRED"
  | "USER_REJECTED"
  | "TRANSFER_CANCELLED"
  | "TRANSFER_TIMEOUT"
  | "CONNECTION_LOST"
  | "FILE_TOO_LARGE"
  | "INVALID_METADATA"
  | "INTEGRITY_MISMATCH"
  | "INSTALLATION_UNAVAILABLE"
  | "INTERNAL_ERROR";

export interface SenderProfile {
  readonly display_name: string;
}

export interface Presentation {
  readonly mode: PresentationMode;
}

export interface WireApplication {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly package_name: string;
  readonly size_bytes: number;
  readonly sha256: string;
}

export interface ApkIdentity {
  readonly package_name: string;
  readonly size_bytes: number;
  readonly sha256: string;
}

export interface ApplicationPresentation {
  readonly name: string;
  readonly version: string;
  readonly description: string;
}

export interface ApplicationMetadata {
  readonly identity: ApkIdentity;
  readonly presentation: ApplicationPresentation;
}

export interface DeliveryRequest {
  readonly type: "delivery_request";
  readonly protocol_version: number;
  readonly request_id: string;
  readonly session_id: string;
  readonly presentation: Presentation;
  readonly sender: SenderProfile;
  readonly application: WireApplication;
}

export interface DeliveryResponse {
  readonly type: "delivery_response";
  readonly request_id: string;
  readonly decision: Decision;
}

export interface ErrorMessage {
  readonly type: "error";
  readonly request_id: string;
  readonly code: ErrorCode;
  readonly message: string;
}

// Transfer-plane control messages (protocol spec §19, §24). The sender assigns
// a per-session transfer_id; the receiver echoes it in progress/ack.
export interface TransferProgress {
  readonly type: "transfer_progress";
  readonly transfer_id: string;
  readonly bytes_transferred: number;
  readonly total_bytes: number;
}

export interface TransferCancel {
  readonly type: "transfer_cancel";
  readonly transfer_id: string;
}

export type ControlMessage =
  | DeliveryRequest
  | DeliveryResponse
  | ErrorMessage
  | TransferProgress
  | TransferCancel;

// Local supporting data — not wire-serializable.
export interface ApkVersion {
  readonly version_code: number | null;
  readonly version_name: string | null;
}

export interface Lifetime {
  readonly created_at_ms: number;
  readonly expires_at_ms: number;
}

export interface DeviceInfo {
  readonly device_name: string;
}

export interface SessionData {
  readonly session_id: string;
  readonly protocol_version: number;
  readonly sender: SenderProfile;
  readonly receiver: DeviceInfo;
  readonly state: DeliveryState;
  readonly lifetime: Lifetime;
}

// Presentation metadata separated from APK identity.
export function splitApplicationMetadata(
  wire: WireApplication,
): ApplicationMetadata {
  return {
    identity: {
      package_name: wire.package_name,
      size_bytes: wire.size_bytes,
      sha256: wire.sha256,
    },
    presentation: {
      name: wire.name,
      version: wire.version,
      description: wire.description,
    },
  };
}
