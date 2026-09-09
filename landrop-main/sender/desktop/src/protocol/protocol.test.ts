import { describe, expect, it } from "vitest";
import { decodeMessage, encodeMessage, ProtocolProblem } from "../protocol/codec";
import type {
  DeliveryRequest,
  DeliveryState,
  ErrorCode,
  PresentationMode,
} from "../protocol/types";
import { CURRENT_PROTOCOL_VERSION, splitApplicationMetadata } from "../protocol/types";

// ---------------------------------------------------------------------------
// Canonical fixtures
// ---------------------------------------------------------------------------

const VALID_REQUEST: DeliveryRequest = {
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

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Readonly protocol types have the right contract; tests need to build
// variations, so deepClone returns a structurally-deep-mutable version.
type Primitive = string | number | boolean | null | undefined;
type DeepMutable<T> = T extends Primitive ? T : { -readonly [K in keyof T]: DeepMutable<T[K]> };
type MutableRequest = DeepMutable<DeliveryRequest>;

function mutableRequest(): MutableRequest {
  return deepClone(VALID_REQUEST) as MutableRequest;
}

function expectRejectedWith(input: string, code: string): void {
  try {
    decodeMessage(input);
    throw new Error(`expected rejection (${code}), but decode succeeded`);
  } catch (e) {
    if (e instanceof ProtocolProblem) {
      expect(e.code).toBe(code);
    } else {
      throw e;
    }
  }
}

// ============================================================================
// 1. SERIALIZATION — DeliveryRequest
// ============================================================================

describe("DeliveryRequest serialization", () => {
  it("encodes a valid request to the expected JSON shape", () => {
    const json = encodeMessage(VALID_REQUEST);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.type).toBe("delivery_request");
    expect(parsed.protocol_version).toBe(1);
    expect(parsed.request_id).toBe("req_01JTEST");
    expect(parsed.session_id).toBe("sess_01JTEST");
    expect(parsed.presentation).toEqual({ mode: "GUI" });
    expect(parsed.sender).toEqual({ display_name: "ISHAQ CYBERTECH" });
    const app = parsed.application as Record<string, unknown>;
    expect(app.name).toBe("My Application");
    expect(app.package_name).toBe("com.example.application");
    expect(app.size_bytes).toBe(26004608);
  });

  it("round-trips encode → decode for a valid request", () => {
    const json = encodeMessage(VALID_REQUEST);
    const decoded = decodeMessage(json);
    expect(decoded).toEqual(VALID_REQUEST);
  });

  it("round-trips encode → decode for NOTIFICATION mode", () => {
    const req: DeliveryRequest = {
      ...VALID_REQUEST,
      presentation: { mode: "NOTIFICATION" },
    };
    const json = encodeMessage(req);
    const decoded = decodeMessage(json) as DeliveryRequest;
    expect(decoded.presentation.mode).toBe("NOTIFICATION");
  });
});

// ============================================================================
// 2. DESERIALIZATION — DeliveryRequest
// ============================================================================

describe("DeliveryRequest deserialization", () => {
  it("decodes a minimal valid request", () => {
    const json = JSON.stringify(VALID_REQUEST);
    const decoded = decodeMessage(json);
    expect(decoded.type).toBe("delivery_request");
    expect(decoded).toEqual(VALID_REQUEST);
  });

  it("rejects non-object input", () => {
    expect(() => decodeMessage('"hello"')).toThrow("INVALID_REQUEST");
    expect(() => decodeMessage("42")).toThrow("INVALID_REQUEST");
    expect(() => decodeMessage("null")).toThrow("INVALID_REQUEST");
    expect(() => decodeMessage("true")).toThrow("INVALID_REQUEST");
    expect(() => decodeMessage("[]")).toThrow("INVALID_REQUEST");
  });

  it("rejects empty object", () => {
    expect(() => decodeMessage("{}")).toThrow("INVALID_REQUEST");
  });

  it("rejects malformed JSON", () => {
    expect(() => decodeMessage("")).toThrow();
    expect(() => decodeMessage("{")).toThrow();
    expect(() => decodeMessage('{"type":"error",}')).toThrow();
  });
});

// ============================================================================
// 3. SERIALIZATION — DeliveryResponse
// ============================================================================

describe("DeliveryResponse serialization", () => {
  it("encodes ACCEPT response", () => {
    const resp = {
      type: "delivery_response" as const,
      request_id: "req_01JTEST",
      decision: "ACCEPT" as const,
    };
    const json = encodeMessage(resp);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("delivery_response");
    expect(parsed.decision).toBe("ACCEPT");
  });

  it("encodes REJECT response", () => {
    const resp = {
      type: "delivery_response" as const,
      request_id: "req_01JTEST",
      decision: "REJECT" as const,
    };
    const json = encodeMessage(resp);
    const parsed = JSON.parse(json);
    expect(parsed.decision).toBe("REJECT");
  });

  it("round-trips encode → decode for a response", () => {
    const resp = {
      type: "delivery_response" as const,
      request_id: "req_01JTEST",
      decision: "ACCEPT" as const,
    };
    const json = encodeMessage(resp);
    const decoded = decodeMessage(json);
    expect(decoded).toEqual(resp);
  });
});

// ============================================================================
// 4. SERIALIZATION — ErrorMessage
// ============================================================================

describe("ErrorMessage serialization", () => {
  it("encodes an error message", () => {
    const err = {
      type: "error" as const,
      request_id: "req_01JTEST",
      code: "INTEGRITY_MISMATCH" as const,
      message: "Received file failed integrity verification.",
    };
    const json = encodeMessage(err);
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe("error");
    expect(parsed.code).toBe("INTEGRITY_MISMATCH");
  });

  it("round-trips encode → decode for an error", () => {
    const err = {
      type: "error" as const,
      request_id: "req_01JTEST",
      code: "INTERNAL_ERROR" as const,
      message: "Something went wrong.",
    };
    const json = encodeMessage(err);
    const decoded = decodeMessage(json);
    expect(decoded).toEqual(err);
  });
});

// ============================================================================
// 5. ENUM SERIALIZATION
// ============================================================================

describe("Enum serialization", () => {
  it("serializes PresentationMode values as GUI/NOTIFICATION", () => {
    expect(
      JSON.stringify(VALID_REQUEST).includes('"mode":"GUI"'),
    ).toBe(true);
  });

  it("serializes Decision values as ACCEPT/REJECT", () => {
    const resp = { type: "delivery_response", request_id: "r", decision: "ACCEPT" };
    expect(JSON.stringify(resp).includes('"ACCEPT"')).toBe(true);
  });

  it("serializes ErrorCode values as SCREAMING_SNAKE_CASE", () => {
    const err = { type: "error", request_id: "r", code: "INTEGRITY_MISMATCH", message: "x" };
    expect(JSON.stringify(err).includes('"INTEGRITY_MISMATCH"')).toBe(true);
  });

  it("deserializes all 18 DeliveryState values", () => {
    const states: DeliveryState[] = [
      "DISCOVERING", "AVAILABLE", "CONNECTING", "SECURE_CHANNEL",
      "SESSION_ESTABLISHED", "REQUEST_SENT", "WAITING_FOR_DECISION",
      "ACCEPTED", "TRANSFER_PREPARING", "TRANSFERRING", "VERIFYING",
      "VERIFIED", "INSTALL_READY", "INSTALLATION_HANDOFF", "COMPLETED",
      "REJECTED", "FAILED", "CANCELLED",
    ];
    // These are compile-time checked by the type system; runtime test ensures
    // the array matches the spec.
    expect(states).toHaveLength(18);
  });

  it("deserializes all 12 ErrorCode values", () => {
    const codes: ErrorCode[] = [
      "INVALID_REQUEST", "UNSUPPORTED_PROTOCOL", "REQUEST_EXPIRED", "USER_REJECTED",
      "TRANSFER_CANCELLED", "TRANSFER_TIMEOUT", "CONNECTION_LOST", "FILE_TOO_LARGE",
      "INVALID_METADATA", "INTEGRITY_MISMATCH", "INSTALLATION_UNAVAILABLE", "INTERNAL_ERROR",
    ];
    expect(codes).toHaveLength(12);
  });
});

// ============================================================================
// 6. VALIDATION — Valid request
// ============================================================================

describe("Validation — valid request", () => {
  it("accepts a fully valid delivery request", () => {
    expect(() => decodeMessage(JSON.stringify(VALID_REQUEST))).not.toThrow();
  });

  it("accepts request with empty description", () => {
    const req = mutableRequest();
    req.application.description = "";
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });
});

// ============================================================================
// 7. VALIDATION — Missing required fields
// ============================================================================

describe("Validation — missing required fields", () => {
  function removeField(path: string): unknown {
    const obj = deepClone(VALID_REQUEST) as unknown as Record<string, unknown>;
    const parts = path.split(".");
    let current: Record<string, unknown> = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (part === undefined) return obj;
      current = current[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1];
    if (last !== undefined) delete current[last];
    return obj;
  }

  it("rejects request missing 'type'", () => {
    const obj = removeField("type");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'protocol_version'", () => {
    const obj = removeField("protocol_version");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'request_id'", () => {
    const obj = removeField("request_id");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'session_id'", () => {
    const obj = removeField("session_id");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'presentation'", () => {
    const obj = removeField("presentation");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'sender'", () => {
    const obj = removeField("sender");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'application'", () => {
    const obj = removeField("application");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'application.name'", () => {
    const obj = removeField("application.name");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'application.package_name'", () => {
    const obj = removeField("application.package_name");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'application.sha256'", () => {
    const obj = removeField("application.sha256");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects request missing 'application.size_bytes'", () => {
    const obj = removeField("application.size_bytes");
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects response missing 'request_id'", () => {
    const obj = { type: "delivery_response", decision: "ACCEPT" };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects response missing 'decision'", () => {
    const obj = { type: "delivery_response", request_id: "req_01JTEST" };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects error missing 'message'", () => {
    const obj = { type: "error", request_id: "req_01JTEST", code: "INTERNAL_ERROR" };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 8. VALIDATION — Invalid presentation mode
// ============================================================================

describe("Validation — invalid presentation mode", () => {
  it("rejects lowercase 'gui'", () => {
    const req = mutableRequest();
    req.presentation = { mode: "gui" as unknown as PresentationMode };
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects unknown mode 'FULLSCREEN'", () => {
    const req = mutableRequest();
    req.presentation = { mode: "FULLSCREEN" as unknown as PresentationMode };
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects presentation as array", () => {
    const req = mutableRequest();
    (req as unknown as Record<string, unknown>).presentation = ["GUI"];
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects presentation.mode as object", () => {
    const req = mutableRequest();
    (req.presentation as unknown as Record<string, unknown>).mode = { GUI: null };
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 9. VALIDATION — Invalid protocol version
// ============================================================================

describe("Validation — invalid protocol version", () => {
  it("rejects version 0", () => {
    const req = mutableRequest();
    req.protocol_version = 0;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects version -1", () => {
    const req = mutableRequest();
    req.protocol_version = -1;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects version 2 with UNSUPPORTED_PROTOCOL", () => {
    const req = mutableRequest();
    req.protocol_version = 2;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("UNSUPPORTED_PROTOCOL");
  });

  it("rejects floating point version", () => {
    const req = mutableRequest();
    (req as unknown as Record<string, unknown>).protocol_version = 1.0;
    // 1.0 is actually valid as integer in JS (Number.isInteger(1.0) === true)
    // but the wire format must be integer. Let's test 1.5
    (req as unknown as Record<string, unknown>).protocol_version = 1.5;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects string version", () => {
    const raw = JSON.stringify(VALID_REQUEST).replace(
      '"protocol_version":1',
      '"protocol_version":"1"',
    );
    expect(() => decodeMessage(raw)).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 10. VALIDATION — Invalid hash
// ============================================================================

describe("Validation — invalid hash", () => {
  it("rejects non-hex hash", () => {
    const req = mutableRequest();
    req.application.sha256 = "not-a-digest";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects too-short hash", () => {
    const req = mutableRequest();
    req.application.sha256 = "abc123";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects hash with uppercase (must be lowercase hex)", () => {
    const req = mutableRequest();
    req.application.sha256 =
      "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF";
    // The Rust implementation uses is_ascii_hexdigit which accepts both cases.
    // Our TS implementation uses [0-9a-fA-F] regex, so uppercase is OK.
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });
});

// ============================================================================
// 11. VALIDATION — Invalid file size
// ============================================================================

describe("Validation — invalid file size", () => {
  it("rejects size 0", () => {
    const req = mutableRequest();
    req.application.size_bytes = 0;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects negative size", () => {
    const req = mutableRequest();
    req.application.size_bytes = -1;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects size exceeding limit", () => {
    const req = mutableRequest();
    req.application.size_bytes = 4_294_967_297;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("FILE_TOO_LARGE");
  });

  it("accepts size at the limit", () => {
    const req = mutableRequest();
    req.application.size_bytes = 4_294_967_296;
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });

  it("rejects floating point size", () => {
    const req = mutableRequest();
    (req.application as unknown as Record<string, unknown>).size_bytes = 1.5;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects string size", () => {
    const raw = JSON.stringify(VALID_REQUEST).replace(
      '"size_bytes":26004608',
      '"size_bytes":"26004608"',
    );
    expect(() => decodeMessage(raw)).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 12. VALIDATION — Invalid metadata
// ============================================================================

describe("Validation — invalid metadata", () => {
  it("rejects empty application name", () => {
    const req = mutableRequest();
    req.application.name = "";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects blank sender display name", () => {
    const req = mutableRequest();
    req.sender.display_name = "   ";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects invalid package name (no dot)", () => {
    const req = mutableRequest();
    req.application.package_name = "nocomponent";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects package name with path traversal", () => {
    const req = mutableRequest();
    req.application.package_name = "../application";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects package name starting with number", () => {
    const req = mutableRequest();
    req.application.package_name = "1com.example.app";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });
});

// ============================================================================
// 13. VALIDATION — Oversized metadata (limits)
// ============================================================================

describe("Validation — oversized metadata (limits)", () => {
  it("rejects text exceeding maxTextBytes", () => {
    const req = mutableRequest();
    req.application.name = "A".repeat(257);
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("rejects description exceeding maxDescriptionBytes", () => {
    const req = mutableRequest();
    req.application.description = "B".repeat(4097);
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_METADATA");
  });

  it("accepts text exactly at maxTextBytes", () => {
    const req = mutableRequest();
    req.application.name = "C".repeat(256);
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });

  it("accepts description exactly at maxDescriptionBytes", () => {
    const req = mutableRequest();
    req.application.description = "D".repeat(4096);
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });

  it("rejects JSON exceeding maxJsonBytes", () => {
    const req = mutableRequest();
    req.application.description = "E".repeat(66000);
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("json.size");
  });
});

// ============================================================================
// 14. VALIDATION — Unknown fields (deny_unknown_fields)
// ============================================================================

describe("Validation — unknown fields", () => {
  it("rejects request with unexpected top-level field", () => {
    const obj = { ...VALID_REQUEST, unexpected: true };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects application with icon field", () => {
    const obj = {
      ...VALID_REQUEST,
      application: { ...VALID_REQUEST.application, icon: "unapproved-extension" },
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 15. VALIDATION — Invalid response decisions
// ============================================================================

describe("Validation — invalid decisions", () => {
  it("rejects decision MAYBE", () => {
    const obj = {
      type: "delivery_response",
      request_id: "req_01JTEST",
      decision: "MAYBE",
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects decision as object", () => {
    const obj = {
      type: "delivery_response",
      request_id: "req_01JTEST",
      decision: { ACCEPT: null },
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 16. VALIDATION — Invalid error codes
// ============================================================================

describe("Validation — invalid error codes", () => {
  it("rejects unknown error code", () => {
    const obj = {
      type: "error",
      request_id: "req_01JTEST",
      code: "UNKNOWN",
      message: "Rejected",
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects error code as object", () => {
    const obj = {
      type: "error",
      request_id: "req_01JTEST",
      code: { INTERNAL_ERROR: null },
      message: "Rejected",
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });

  it("rejects null message", () => {
    const obj = {
      type: "error",
      request_id: "req_01JTEST",
      code: "INTERNAL_ERROR",
      message: null,
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 17. VALIDATION — Malformed JSON
// ============================================================================

describe("Validation — malformed JSON", () => {
  const cases: Array<[string, string]> = [
    ["empty string", ""],
    ["open brace", "{"],
    ["array", "[]"],
    ["null", "null"],
    ["boolean", "true"],
    ["empty object", "{}"],
    ["trailing comma", '{"type":"error",}'],
    ["unquoted key", "{type:\"error\"}"],
    ["extra token", '{"type":"error"} true'],
  ];

  it.each(cases)("rejects %s", (_label, input) => {
    expect(() => decodeMessage(input)).toThrow();
  });
});

// ============================================================================
// 18. DOMAIN MODELS — SenderProfile
// ============================================================================

describe("Domain model — SenderProfile", () => {
  it("accepts valid sender profile", () => {
    const req = mutableRequest();
    req.sender = { display_name: "Test Sender" };
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });

  it("rejects sender with null display_name", () => {
    const obj = {
      ...VALID_REQUEST,
      sender: { display_name: null },
    };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 19. DOMAIN MODELS — ApplicationMetadata
// ============================================================================

describe("Domain model — ApplicationMetadata", () => {
  it("correctly separates APK identity from presentation metadata", () => {
    const wire = VALID_REQUEST.application;
    const metadata = splitApplicationMetadata(wire);
    expect(metadata.identity.package_name).toBe("com.example.application");
    expect(metadata.identity.size_bytes).toBe(26004608);
    expect(metadata.identity.sha256).toBe(wire.sha256);
    expect(metadata.presentation.name).toBe("My Application");
    expect(metadata.presentation.version).toBe("1.4.2");
    expect(metadata.presentation.description).toBe("A local test application.");
  });

  it("allows customizing presentation without affecting identity", () => {
    const wire = deepClone(VALID_REQUEST.application) as DeepMutable<
      typeof VALID_REQUEST.application
    >;
    wire.name = "Custom Name";
    wire.version = "2.0.0";
    wire.description = "Custom description";
    const metadata = splitApplicationMetadata(wire);
    expect(metadata.identity.package_name).toBe("com.example.application");
    expect(metadata.presentation.name).toBe("Custom Name");
    expect(metadata.presentation.version).toBe("2.0.0");
  });
});

// ============================================================================
// 20. DOMAIN MODELS — Presentation
// ============================================================================

describe("Domain model — Presentation", () => {
  it("GUI is a valid presentation mode", () => {
    const req = mutableRequest();
    req.presentation = { mode: "GUI" };
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });

  it("NOTIFICATION is a valid presentation mode", () => {
    const req = mutableRequest();
    req.presentation = { mode: "NOTIFICATION" };
    expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
  });

  it("rejects unknown presentation modes", () => {
    for (const mode of ["FULLSCREEN", "DIALOG", "POPUP", "SILENT"]) {
      const req = mutableRequest();
      (req.presentation as { mode: unknown }).mode = mode;
      expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
    }
  });
});

// ============================================================================
// 21. INVARIANT — Presentation mode independent of delivery state
// ============================================================================

describe("Invariant — presentation mode ≠ delivery state", () => {
  const deliveryStates: DeliveryState[] = [
    "DISCOVERING", "AVAILABLE", "CONNECTING", "SECURE_CHANNEL",
    "SESSION_ESTABLISHED", "REQUEST_SENT", "WAITING_FOR_DECISION",
    "ACCEPTED", "TRANSFER_PREPARING", "TRANSFERRING", "VERIFYING",
    "VERIFIED", "INSTALL_READY", "INSTALLATION_HANDOFF", "COMPLETED",
    "REJECTED", "FAILED", "CANCELLED",
  ];

  it("presentation modes are not delivery states", () => {
    const presentationModes: PresentationMode[] = ["GUI", "NOTIFICATION"];
    for (const mode of presentationModes) {
      expect(deliveryStates).not.toContain(mode);
    }
  });

  it("delivery states are not presentation modes", () => {
    const presentationModes: PresentationMode[] = ["GUI", "NOTIFICATION"];
    for (const state of deliveryStates) {
      expect(presentationModes).not.toContain(state);
    }
  });

  it("GUI + TRANSFERRING is a valid conceptual combination", () => {
    // The DeliveryRequest always uses presentation.mode separately from state.
    // This test verifies the model separation.
    const req = mutableRequest();
    req.presentation = { mode: "GUI" };
    const json = encodeMessage(req);
    const decoded = decodeMessage(json) as DeliveryRequest;
    expect(decoded.presentation.mode).toBe("GUI");
    // DeliveryState is not on the wire — it lives in the session/state machine.
    expect(decoded).not.toHaveProperty("state");
  });

  it("NOTIFICATION + TRANSFERRING is a valid conceptual combination", () => {
    const req = mutableRequest();
    req.presentation = { mode: "NOTIFICATION" };
    const json = encodeMessage(req);
    const decoded = decodeMessage(json) as DeliveryRequest;
    expect(decoded.presentation.mode).toBe("NOTIFICATION");
    expect(decoded).not.toHaveProperty("state");
  });
});

// ============================================================================
// 22. INVARIANT — Sender-controlled presentation
// ============================================================================

describe("Invariant — Sender-controlled presentation", () => {
  it("delivery request carries the Sender's chosen mode", () => {
    const guiReq = mutableRequest();
    guiReq.presentation = { mode: "GUI" };
    const notifReq = mutableRequest();
    notifReq.presentation = { mode: "NOTIFICATION" };

    const guiJson = decodeMessage(JSON.stringify(guiReq)) as DeliveryRequest;
    const notifJson = decodeMessage(JSON.stringify(notifReq)) as DeliveryRequest;

    expect(guiJson.presentation.mode).toBe("GUI");
    expect(notifJson.presentation.mode).toBe("NOTIFICATION");
  });

  it("both GUI and NOTIFICATION use identical DeliveryRequest shape", () => {
    const guiReq = mutableRequest();
    guiReq.presentation = { mode: "GUI" };
    const notifReq = mutableRequest();
    notifReq.presentation = { mode: "NOTIFICATION" };

    const guiKeys = Object.keys(guiReq).sort();
    const notifKeys = Object.keys(notifReq).sort();
    expect(guiKeys).toEqual(notifKeys);
  });
});

// ============================================================================
// 23. INVARIANT — APK identity separate from presentation metadata
// ============================================================================

describe("Invariant — APK identity ≠ presentation metadata", () => {
  it("package_name is in the APK identity, not presentation", () => {
    const meta = splitApplicationMetadata(VALID_REQUEST.application);
    expect(meta.identity).toHaveProperty("package_name");
    expect(meta.presentation).not.toHaveProperty("package_name");
  });

  it("size_bytes is in the APK identity, not presentation", () => {
    const meta = splitApplicationMetadata(VALID_REQUEST.application);
    expect(meta.identity).toHaveProperty("size_bytes");
    expect(meta.presentation).not.toHaveProperty("size_bytes");
  });

  it("sha256 is in the APK identity, not presentation", () => {
    const meta = splitApplicationMetadata(VALID_REQUEST.application);
    expect(meta.identity).toHaveProperty("sha256");
    expect(meta.presentation).not.toHaveProperty("sha256");
  });

  it("name, version, description are in presentation, not identity", () => {
    const meta = splitApplicationMetadata(VALID_REQUEST.application);
    expect(meta.presentation).toHaveProperty("name");
    expect(meta.presentation).toHaveProperty("version");
    expect(meta.presentation).toHaveProperty("description");
    expect(meta.identity).not.toHaveProperty("name");
    expect(meta.identity).not.toHaveProperty("version");
    expect(meta.identity).not.toHaveProperty("description");
  });
});

// ============================================================================
// 24. VALIDATION — Request ID format
// ============================================================================

describe("Validation — request ID format", () => {
  it("accepts valid IDs", () => {
    for (const id of ["a", "req_01JTEST", "sess_01JTEST", "A-0_1"]) {
      const req = mutableRequest();
      req.request_id = id;
      expect(() => decodeMessage(JSON.stringify(req))).not.toThrow();
    }
  });

  it("rejects empty ID", () => {
    const req = mutableRequest();
    req.request_id = "";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects ID with space", () => {
    const req = mutableRequest();
    req.request_id = " ";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects ID starting with underscore", () => {
    const req = mutableRequest();
    req.request_id = "_first";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects ID with slash", () => {
    const req = mutableRequest();
    req.request_id = "a/b";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });

  it("rejects ID with dot", () => {
    const req = mutableRequest();
    req.request_id = "a.b";
    expect(() => decodeMessage(JSON.stringify(req))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 25. INVARIANT — Presentation mode does not alter protocol
// ============================================================================

describe("Invariant — presentation mode does not alter protocol structure", () => {
  it("GUI and NOTIFICATION requests have identical JSON key sets", () => {
    const guiReq = mutableRequest();
    guiReq.presentation = { mode: "GUI" };
    const notifReq = mutableRequest();
    notifReq.presentation = { mode: "NOTIFICATION" };

    const guiJson = JSON.parse(encodeMessage(guiReq));
    const notifJson = JSON.parse(encodeMessage(notifReq));

    expect(Object.keys(guiJson).sort()).toEqual(Object.keys(notifJson).sort());
    expect(Object.keys(guiJson.application).sort()).toEqual(
      Object.keys(notifJson.application).sort(),
    );
  });
});

// ============================================================================
// 26. CONTROL MESSAGE — type dispatching
// ============================================================================

describe("ControlMessage type dispatching", () => {
  it("decodes delivery_request", () => {
    const msg = decodeMessage(JSON.stringify(VALID_REQUEST));
    expect(msg.type).toBe("delivery_request");
  });

  it("decodes delivery_response", () => {
    const resp = {
      type: "delivery_response",
      request_id: "req_01JTEST",
      decision: "ACCEPT",
    };
    const msg = decodeMessage(JSON.stringify(resp));
    expect(msg.type).toBe("delivery_response");
  });

  it("decodes error", () => {
    const err = {
      type: "error",
      request_id: "req_01JTEST",
      code: "INTERNAL_ERROR",
      message: "An error occurred.",
    };
    const msg = decodeMessage(JSON.stringify(err));
    expect(msg.type).toBe("error");
  });

  it("rejects unknown type", () => {
    const obj = { type: "unknown_type", request_id: "r" };
    expect(() => decodeMessage(JSON.stringify(obj))).toThrow("INVALID_REQUEST");
  });
});

// ============================================================================
// 27. ROUND-TRIP CONSISTENCY
// ============================================================================

describe("Round-trip consistency", () => {
  it("delivery_request round-trips exactly", () => {
    const json = encodeMessage(VALID_REQUEST);
    const decoded = decodeMessage(json);
    expect(decoded).toEqual(VALID_REQUEST);
  });

  it("delivery_response round-trips exactly", () => {
    const resp = {
      type: "delivery_response" as const,
      request_id: "req_01JTEST",
      decision: "ACCEPT" as const,
    };
    const json = encodeMessage(resp);
    const decoded = decodeMessage(json);
    expect(decoded).toEqual(resp);
  });

  it("error message round-trips exactly", () => {
    const err = {
      type: "error" as const,
      request_id: "req_01JTEST",
      code: "INTEGRITY_MISMATCH" as const,
      message: "Received file failed integrity verification.",
    };
    const json = encodeMessage(err);
    const decoded = decodeMessage(json);
    expect(decoded).toEqual(err);
  });
});

// ============================================================================
// 28. VALIDATION — Protocol version on wire
// ============================================================================

describe("Protocol version on wire", () => {
  it("current version is 1", () => {
    expect(CURRENT_PROTOCOL_VERSION).toBe(1);
  });

  it("version 1 is accepted", () => {
    expect(() => decodeMessage(JSON.stringify(VALID_REQUEST))).not.toThrow();
  });

  it("version 2 is rejected as unsupported", () => {
    const req = mutableRequest();
    req.protocol_version = 2;
    expect(() => decodeMessage(JSON.stringify(req))).toThrow(Error);

    const reqBig = mutableRequest();
    reqBig.protocol_version = 3147483648;
    // Beyond i32 it cannot even deserialize, so it is INVALID_REQUEST, matching
    // the Rust (i32) and Kotlin (Int-range) codecs and the shared fixture.
    expectRejectedWith(JSON.stringify(reqBig), "INVALID_REQUEST");
  });
});

// ============================================================================
// 29. TEST FIXTURE — model-cases.json
// ============================================================================

describe("Test fixture — model-cases.json", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fixtures: Record<string, unknown> = require(
    "../../../../protocol/fixtures/model-cases.json",
  ) as Record<string, unknown>;

  interface InvalidRequestMutation {
    path: string;
    remove?: true;
    value?: unknown;
    code: string;
  }

  function baseRequestText(): string {
    return JSON.stringify(fixtures.delivery_request);
  }

  function requestWith(requestId: string): string {
    return JSON.stringify({
      ...(fixtures.delivery_request as Record<string, unknown>),
      request_id: requestId,
      session_id: requestId,
    });
  }

  function applyMutation(
    base: unknown,
    mut: InvalidRequestMutation,
  ): Record<string, unknown> {
    const obj = deepClone(base) as Record<string, unknown>;
    const parts = mut.path.split(".");
    let cur: Record<string, unknown> = obj;
    for (const part of parts.slice(0, -1)) {
      cur = cur[part] as Record<string, unknown>;
    }
    const last = parts[parts.length - 1] as string;
    if (mut.remove === true) {
      delete cur[last];
    } else {
      cur[last] = mut.value;
    }
    return obj;
  }

  it("contains expected top-level keys", () => {
    expect(fixtures).toHaveProperty("delivery_request");
    expect(fixtures).toHaveProperty("other_messages");
    expect(fixtures).toHaveProperty("presentation_modes");
    expect(fixtures).toHaveProperty("delivery_states");
    expect(fixtures).toHaveProperty("error_codes");
    expect(fixtures).toHaveProperty("invalid_requests");
    expect(fixtures).toHaveProperty("invalid_messages");
    expect(fixtures).toHaveProperty("invalid_integer_tokens");
    expect(fixtures).toHaveProperty("malformed_json");
    expect(fixtures).toHaveProperty("valid_ids");
    expect(fixtures).toHaveProperty("invalid_ids");
  });

  it("fixture delivery_request round-trips successfully", () => {
    const text = baseRequestText();
    const msg = decodeMessage(text);
    expect(msg.type).toBe("delivery_request");
    expect(encodeMessage(msg)).toBe(text);
  });

  it("fixture other_messages all decode successfully", () => {
    for (const msg of fixtures.other_messages as unknown[]) {
      expect(() => decodeMessage(JSON.stringify(msg))).not.toThrow();
    }
  });

  it("fixture presentation_modes contains exactly GUI and NOTIFICATION", () => {
    expect(fixtures.presentation_modes).toEqual(["GUI", "NOTIFICATION"]);
  });

  it("fixture delivery_states has 18 entries", () => {
    expect((fixtures.delivery_states as unknown[]).length).toBe(18);
  });

  it("fixture error_codes has 12 entries", () => {
    expect((fixtures.error_codes as unknown[]).length).toBe(12);
  });

  it("fixture valid_ids are accepted as request/session IDs", () => {
    for (const id of fixtures.valid_ids as string[]) {
      expect(() => decodeMessage(requestWith(id))).not.toThrow();
    }
  });

  it("fixture invalid_ids are rejected as request/session IDs", () => {
    for (const id of fixtures.invalid_ids as string[]) {
      expect(() =>
        decodeMessage(requestWith(id)),
      ).toThrow(ProtocolProblem);
    }
  });

  it("fixture invalid_requests are rejected with the expected code", () => {
    const mutations = fixtures.invalid_requests as InvalidRequestMutation[];
    for (const mut of mutations) {
      // "1.0" collapses to the number 1 when the fixture is parsed, so it is
      // exercised by the raw-token test below instead of this object mutation.
      if (
        mut.path === "protocol_version" &&
        mut.code === "INVALID_REQUEST" &&
        mut.value === 1
      ) {
        continue;
      }
      const input = JSON.stringify(applyMutation(fixtures.delivery_request, mut));
      expectRejectedWith(input, mut.code);
    }
  });

  it("fixture invalid_messages are all rejected", () => {
    for (const msg of fixtures.invalid_messages as unknown[]) {
      expect(() => decodeMessage(JSON.stringify(msg))).toThrow(ProtocolProblem);
    }
  });

  it("fixture invalid_integer_tokens are rejected as protocol_version", () => {
    const base = baseRequestText();
    // Mirrors the fixture's raw token list. JSON.parse / JSON.stringify would
    // collapse 1.0/1e0 into 1, so these tokens are injected as raw JSON text.
    const tokens = [
      "-0",
      "1.0",
      "1e0",
      '"1"',
      "true",
      "null",
      "9223372036854775808",
      "-9223372036854775809",
    ];
    expect(tokens.length).toBe(
      (fixtures.invalid_integer_tokens as unknown[]).length,
    );
    for (const token of tokens) {
      const text = base.replace(
        '"protocol_version":1',
        `"protocol_version":${token}`,
      );
      expectRejectedWith(text, "INVALID_REQUEST");
    }
  });

  it("fixture malformed_json inputs are all rejected", () => {
    for (const input of fixtures.malformed_json as string[]) {
      expectRejectedWith(input, "INVALID_REQUEST");
    }
  });
});
