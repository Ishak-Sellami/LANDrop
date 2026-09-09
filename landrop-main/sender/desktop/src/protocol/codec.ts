// Protocol v1 codec — JSON encode/decode with validation.
// Mirrors the Rust implementation in src-tauri/src/protocol/.

import type {
  ControlMessage,
  DeliveryRequest,
  DeliveryResponse,
  ErrorMessage,
  ErrorCode,
  TransferCancel,
  TransferProgress,
} from "./types";
import { CURRENT_PROTOCOL_VERSION } from "./types";

export interface Limits {
  readonly maxJsonBytes: number;
  readonly maxTextBytes: number;
  readonly maxDescriptionBytes: number;
  readonly maxApkBytes: number;
}

export const DEFAULT_LIMITS: Limits = {
  maxJsonBytes: 65536,
  maxTextBytes: 256,
  maxDescriptionBytes: 4096,
  maxApkBytes: 4_294_967_296,
};

export class ProtocolProblem extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly field: string,
  ) {
    super(`${code}: ${field}`);
    this.name = "ProtocolProblem";
  }
}

function invalid(field: string): never {
  throw new ProtocolProblem("INVALID_REQUEST", field);
}

function metadata(field: string): never {
  throw new ProtocolProblem("INVALID_METADATA", field);
}

function text(value: string, max: number, allowEmpty: boolean, field: string): void {
  const trimmed = value.replace(/[\t\r\n ]/g, "");
  const byteLength = new TextEncoder().encode(value).length;
  if (byteLength > max || value.includes("\0") || (!allowEmpty && trimmed.length === 0)) {
    metadata(field);
  }
}

// ASCII ID grammar: [A-Za-z0-9][A-Za-z0-9_-]{0,127}
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export const HEX64_RE = /^[0-9a-fA-F]{64}$/;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

export function isValidProtocolId(value: string): boolean {
  return ID_RE.test(value);
}

function validateProtocolVersion(v: number): void {
  if (!Number.isInteger(v) || v <= 0) invalid("protocol_version");
  // Rust models ProtocolVersion as i32; out-of-range values are rejected as
  // INVALID_REQUEST, never classified as an unsupported (but well-formed) version.
  if (!Number.isSafeInteger(v) || v < -2147483648 || v > 2147483647)
    invalid("protocol_version");
  if (v !== CURRENT_PROTOCOL_VERSION) {
    throw new ProtocolProblem("UNSUPPORTED_PROTOCOL", "protocol_version");
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") invalid(field);
  return value;
}

function validateId(value: unknown, field: string): void {
  const s = requireString(value, field);
  if (!ID_RE.test(s)) invalid(field);
}

function validateSha256(value: string): void {
  if (!HEX64_RE.test(value)) invalid("application.sha256");
}

function validateApplication(app: unknown, limits: Limits): void {
  if (typeof app !== "object" || app === null) invalid("application");
  const a = app as Record<string, unknown>;
  const allowed = new Set(["name", "version", "description", "package_name", "size_bytes", "sha256"]);
  for (const key of Object.keys(a)) {
    if (!allowed.has(key)) invalid("application");
  }
  const packageName = requireString(a.package_name, "application.package_name");
  if (!PACKAGE_RE.test(packageName) || packageName.length > 255)
    metadata("application.package_name");

  const sizeBytes = a.size_bytes;
  if (typeof sizeBytes !== "number" || !Number.isInteger(sizeBytes))
    metadata("application.size_bytes");
  if (sizeBytes <= 0) metadata("application.size_bytes");
  if (sizeBytes > limits.maxApkBytes)
    throw new ProtocolProblem("FILE_TOO_LARGE", "application.size_bytes");

  validateSha256(requireString(a.sha256, "application.sha256"));
  text(requireString(a.name, "application.name"), limits.maxTextBytes, false, "application.name");
  text(requireString(a.version, "application.version"), limits.maxTextBytes, false, "application.version");
  text(requireString(a.description, "application.description"), limits.maxDescriptionBytes, true, "application.description");
}

function validateRequest(req: DeliveryRequest, limits: Limits): void {
  validateProtocolVersion(req.protocol_version);
  validateId(req.request_id, "request_id");
  validateId(req.session_id, "session_id");
  if (!req.presentation || typeof req.presentation.mode !== "string")
    invalid("presentation");
  if (req.presentation.mode !== "GUI" && req.presentation.mode !== "NOTIFICATION")
    invalid("presentation.mode");
  if (!req.sender || typeof req.sender.display_name !== "string")
    invalid("sender");
  text(req.sender.display_name, limits.maxTextBytes, false, "sender.display_name");
  validateApplication(req.application, limits);
}

function validateResponse(resp: DeliveryResponse): void {
  validateId(resp.request_id, "request_id");
  if (resp.decision !== "ACCEPT" && resp.decision !== "REJECT")
    invalid("decision");
}

function validateError(err: ErrorMessage, limits: Limits): void {
  validateId(err.request_id, "request_id");
  if (typeof err.code !== "string") invalid("code");
  const validCodes: readonly string[] = [
    "INVALID_REQUEST", "UNSUPPORTED_PROTOCOL", "REQUEST_EXPIRED", "USER_REJECTED",
    "TRANSFER_CANCELLED", "TRANSFER_TIMEOUT", "CONNECTION_LOST", "FILE_TOO_LARGE",
    "INVALID_METADATA", "INTEGRITY_MISMATCH", "INSTALLATION_UNAVAILABLE", "INTERNAL_ERROR",
  ];
  if (!validCodes.includes(err.code)) invalid("code");
  if (typeof err.message !== "string") invalid("message");
  text(err.message, limits.maxDescriptionBytes, false, "message");
}

function validateTransferProgress(progress: TransferProgress): void {
  validateId(progress.transfer_id, "transfer_id");
  if (!Number.isSafeInteger(progress.bytes_transferred) || progress.bytes_transferred < 0)
    invalid("bytes_transferred");
  if (!Number.isSafeInteger(progress.total_bytes) || progress.total_bytes < 0)
    invalid("total_bytes");
  if (progress.bytes_transferred > progress.total_bytes)
    invalid("bytes_transferred");
}

function validateTransferCancel(cancel: TransferCancel): void {
  validateId(cancel.transfer_id, "transfer_id");
}

function validateMessage(msg: ControlMessage, limits: Limits): void {
  switch (msg.type) {
    case "delivery_request":
      validateRequest(msg, limits);
      break;
    case "delivery_response":
      validateResponse(msg);
      break;
    case "error":
      validateError(msg, limits);
      break;
    case "transfer_progress":
      validateTransferProgress(msg);
      break;
    case "transfer_cancel":
      validateTransferCancel(msg);
      break;
  }
}

// Wire shape checks — mirrors Rust check_wire_shape + deny_unknown_fields.
function checkWireShape(value: Record<string, unknown>): void {
  if (typeof value.type !== "string") invalid("json");
  const kind = value.type;

  if (kind === "delivery_request") {
    const allowed = new Set(["type", "protocol_version", "request_id", "session_id", "presentation", "sender", "application"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) invalid("json");
    }
    for (const key of ["application", "sender", "presentation"]) {
      if (typeof value[key] !== "object" || value[key] === null) invalid("json");
    }
    const pres = value.presentation as Record<string, unknown>;
    if (typeof pres.mode !== "string") invalid("json");
    const app = value.application as Record<string, unknown>;
    const appAllowed = new Set(["name", "version", "description", "package_name", "size_bytes", "sha256"]);
    for (const key of Object.keys(app)) {
      if (!appAllowed.has(key)) invalid("json");
    }
  } else if (kind === "delivery_response") {
    const allowed = new Set(["type", "request_id", "decision"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) invalid("json");
    }
    if (typeof value.decision !== "string") invalid("json");
  } else if (kind === "error") {
    const allowed = new Set(["type", "request_id", "code", "message"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) invalid("json");
    }
    if (typeof value.code !== "string") invalid("json");
  } else if (kind === "transfer_progress") {
    const allowed = new Set(["type", "transfer_id", "bytes_transferred", "total_bytes"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) invalid("json");
    }
  } else if (kind === "transfer_cancel") {
    const allowed = new Set(["type", "transfer_id"]);
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) invalid("json");
    }
  } else {
    invalid("json");
  }
}

// Input bounds check — mirrors Rust check_input.
function checkInput(input: string, limits: Limits): void {
  if (new TextEncoder().encode(input).length > limits.maxJsonBytes) invalid("json.size");
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (const c of input) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else {
      if (c === '"') quoted = true;
      else if (c === "{" || c === "[") {
        depth++;
        if (depth > 16) invalid("json.depth");
      } else if (c === "}" || c === "]") depth--;
    }
  }
}

function parseInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) invalid(field);
  return value;
}

// JSON.parse collapses textually-float integral tokens such as "1.0"/"1e0"
// into plain numbers, which would let float-typed wire values slip through.
// Both the Rust and Kotlin codecs reject those at the token level, so verify
// the raw token text for integer fields ("protocol_version", size_bytes).
const INTEGER_TOKEN_RE = /^-?(0|[1-9][0-9]*)$/;
const TOKEN_END_RE = /[,}\]]|\s/;

function rawTokenFor(input: string, name: string): string | undefined {
  let result: string | undefined;
  let i = 0;
  let inString = false;
  let escaped = false;
  while (i < input.length) {
    const c = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      i++;
    } else if (c === '"') {
      const tail = input.slice(i, i + name.length + 2);
      if (tail === `"${name}"`) {
        i += name.length + 2;
        while (i < input.length && /[ \t\r\n]/.test(input.charAt(i))) i++;
        let token: string | undefined;
        if (input.charAt(i) === ":") {
          i++;
          while (i < input.length && /[ \t\r\n]/.test(input.charAt(i))) i++;
          const start = i;
          while (i < input.length && !TOKEN_END_RE.test(input.charAt(i))) i++;
          token = input.slice(start, i);
        }
        if (token !== undefined && token.length > 0) result = token;
        continue;
      }
      inString = true;
      i++;
    } else {
      i++;
    }
  }
  return result;
}

function checkIntegerToken(input: string, name: string, field: string): void {
  const token = rawTokenFor(input, name);
  if (token === undefined || token === "-0" || !INTEGER_TOKEN_RE.test(token)) {
    invalid(field);
  }
}

export function decodeMessage(
  input: string,
  limits: Limits = DEFAULT_LIMITS,
): ControlMessage {
  checkInput(input, limits);

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    invalid("json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    invalid("json");

  const root = parsed as Record<string, unknown>;
  checkWireShape(root);

  const kind = root.type as string;
  switch (kind) {
    case "delivery_request": {
      const app = root.application as Record<string, unknown>;
      checkIntegerToken(input, "protocol_version", "protocol_version");
      checkIntegerToken(input, "size_bytes", "application.size_bytes");
      const msg: DeliveryRequest = {
        type: "delivery_request",
        protocol_version: parseInteger(root.protocol_version, "protocol_version"),
        request_id: root.request_id as string,
        session_id: root.session_id as string,
        presentation: root.presentation as { mode: "GUI" | "NOTIFICATION" },
        sender: root.sender as { display_name: string },
        application: {
          name: app.name as string,
          version: app.version as string,
          description: app.description as string,
          package_name: app.package_name as string,
          size_bytes: parseInteger(app.size_bytes, "application.size_bytes"),
          sha256: app.sha256 as string,
        },
      };
      validateMessage(msg, limits);
      return msg;
    }
    case "delivery_response": {
      const msg: DeliveryResponse = {
        type: "delivery_response",
        request_id: root.request_id as string,
        decision: root.decision as "ACCEPT" | "REJECT",
      };
      validateMessage(msg, limits);
      return msg;
    }
    case "error": {
      const msg: ErrorMessage = {
        type: "error",
        request_id: root.request_id as string,
        code: root.code as ErrorCode,
        message: root.message as string,
      };
      validateMessage(msg, limits);
      return msg;
    }
    case "transfer_progress": {
      checkIntegerToken(input, "bytes_transferred", "bytes_transferred");
      checkIntegerToken(input, "total_bytes", "total_bytes");
      const msg: TransferProgress = {
        type: "transfer_progress",
        transfer_id: root.transfer_id as string,
        bytes_transferred: parseInteger(root.bytes_transferred, "bytes_transferred"),
        total_bytes: parseInteger(root.total_bytes, "total_bytes"),
      };
      validateMessage(msg, limits);
      return msg;
    }
    case "transfer_cancel": {
      const msg: TransferCancel = {
        type: "transfer_cancel",
        transfer_id: root.transfer_id as string,
      };
      validateMessage(msg, limits);
      return msg;
    }
    default:
      invalid("json");
  }
}

export function encodeMessage(
  message: ControlMessage,
  limits: Limits = DEFAULT_LIMITS,
): string {
  validateMessage(message, limits);
  const json = JSON.stringify(message);
  checkInput(json, limits);
  return json;
}
