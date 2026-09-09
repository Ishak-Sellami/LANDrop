import { describe, expect, it } from "vitest";

import { encodeFrame, FRAME_LENGTH_BYTES } from "./framing";
import { encodeJsonFrame, JsonMessageStream } from "./message-stream";
import { createInMemoryDuplex } from "./transport";
import type { DeliveryRequest } from "./types";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const framing = fixtures.framing as {
  payloads: Record<string, string>;
  frame_sequence: string[];
};

const pay = (name: string): string => framing.payloads[name] ?? "";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

// Encode a payload string and unwrap the success (fixture payloads always fit).
const frameBytes = (s: string): Uint8Array => {
  const encoded = encodeFrame(text(s));
  if (!encoded.ok) throw new Error("unexpected oversized frame");
  return encoded.bytes;
};

const concat = (...buffers: Uint8Array[]): Uint8Array => {
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
};

const feedAll = (stream: JsonMessageStream, bytes: Uint8Array): void => {
  for (const byte of bytes) {
    stream.feed(new Uint8Array([byte]));
  }
};

const exhaust = (stream: JsonMessageStream): unknown[] => {
  const out: unknown[] = [];
  for (;;) {
    const result = stream.readMessage();
    if (result.outcome !== "message") break;
    out.push(result.message);
  }
  return out;
};

describe("fixture parity - message stream", () => {
  it("decodes the shared payloads to typed messages", () => {
    const stream = new JsonMessageStream();
    stream.feed(frameBytes(pay("error_integrity")));
    const error = stream.readMessage();
    expect(error).toMatchObject({
      outcome: "message",
      message: { type: "error", code: "INTEGRITY_MISMATCH" },
    });

    const accept = new JsonMessageStream();
    accept.feed(frameBytes(pay("response_accept")));
    expect(accept.readMessage()).toMatchObject({
      outcome: "message",
      message: { type: "delivery_response", decision: "ACCEPT" },
    });

    const gui = new JsonMessageStream();
    gui.feed(frameBytes(pay("request_gui")));
    expect(gui.readMessage()).toMatchObject({
      outcome: "message",
      message: {
        type: "delivery_request",
        presentation: { mode: "GUI" },
        application: { package_name: "com.example.application" },
      },
    });
  });

  it("emits frames in order from a single packet over a byte-by-byte stream", () => {
    const a = framing.frame_sequence[0] ?? "";
    const b = framing.frame_sequence[1] ?? "";
    const packet = concat(frameBytes(pay(a)), frameBytes(pay(b)));
    const stream = new JsonMessageStream();
    feedAll(stream, packet);
    const messages = exhaust(stream);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ type: "error", code: "INTEGRITY_MISMATCH" });
    expect(messages[1]).toMatchObject({ type: "delivery_response", decision: "ACCEPT" });
    expect(stream.endOfStream()).toEqual({ outcome: "ok" });
  });

  it("reports incomplete and then ok once the stream is fully consumed", () => {
    const stream = new JsonMessageStream();
    stream.feed(frameBytes(pay("response_accept")));
    expect(stream.readMessage()).toMatchObject({ outcome: "message" });
    // Now: a trailing partial header.
    stream.feed(new Uint8Array([0x00, 0x00, 0x00]));
    expect(stream.readMessage()).toEqual({ outcome: "incomplete" });
    expect(stream.endOfStream()).toEqual({ outcome: "frame-error", problem: { code: "TRUNCATED" } });
  });
});

describe("frame errors surface as frame-error", () => {
  it("rejects an oversized length", () => {
    const stream = new JsonMessageStream();
    stream.feed(new Uint8Array([0x00, 0x02, 0x00, 0x00]));
    expect(() => stream.feed(new Uint8Array([0xaa, 0xbb]))).not.toThrow();
    expect(stream.readMessage()).toEqual({
      outcome: "frame-error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
  });

  it("flags a truncated final body at end of stream", () => {
    const stream = new JsonMessageStream();
    stream.feed(new Uint8Array([0x00, 0x00, 0x00, 0x04, 0xaa]));
    expect(stream.readMessage()).toEqual({ outcome: "incomplete" });
    expect(stream.endOfStream()).toEqual({
      outcome: "frame-error",
      problem: { code: "TRUNCATED" },
    });
  });
});

describe("protocol errors inside a frame become protocol-error", () => {
  it("maps an empty payload to INVALID_REQUEST", () => {
    const stream = new JsonMessageStream();
    stream.feed(new Uint8Array([0, 0, 0, 0]));
    const result = stream.readMessage();
    expect(result).toMatchObject({
      outcome: "protocol-error",
      problem: { code: "INVALID_REQUEST" },
    });
  });

  it("maps malformed JSON to INVALID_REQUEST", () => {
    const stream = new JsonMessageStream();
    stream.feed(frameBytes("{"));
    expect(stream.readMessage()).toMatchObject({
      outcome: "protocol-error",
      problem: { code: "INVALID_REQUEST" },
    });
  });

  it("maps invalid UTF-8 to INVALID_REQUEST json", () => {
    // 2-byte payload of non-UTF-8 bytes.
    const stream = new JsonMessageStream();
    stream.feed(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x80, 0xf1]));
    expect(stream.readMessage()).toMatchObject({
      outcome: "protocol-error",
      problem: { code: "INVALID_REQUEST" },
    });
  });

  it("maps a violation to the original codec problem, e.g. UNSUPPORTED_PROTOCOL", () => {
    // The request_gui fixture is shape-valid; only the version is wrong.
    const raw = pay("request_gui").replace('"protocol_version":1', '"protocol_version":2');
    const stream = new JsonMessageStream();
    stream.feed(frameBytes(raw));
    expect(stream.readMessage()).toMatchObject({
      outcome: "protocol-error",
      problem: { code: "UNSUPPORTED_PROTOCOL" },
    });
  });
});

describe("encodeJsonFrame", () => {
  const makeRequest = (): DeliveryRequest => ({
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
      sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  });

  it("round-trips a typed message through one frame", () => {
    const request = makeRequest();
    const encoded = encodeJsonFrame(request);
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      const stream = new JsonMessageStream();
      stream.feed(encoded.bytes);
      expect(stream.readMessage()).toEqual({ outcome: "message", message: request });
    }
  });

  it("rejects an invalid message with the codec problem", () => {
    const bad = { ...makeRequest(), protocol_version: 0 };
    const encoded = encodeJsonFrame(bad);
    expect(encoded.ok).toBe(false);
    if (!encoded.ok) {
      expect(encoded.problem).toMatchObject({ code: "INVALID_REQUEST" });
    }
  });
});

describe("transport integration", () => {
  it("moves real frames through the in-memory transport into messages", () => {
    const { left, right } = createInMemoryDuplex();
    const packet = frameBytes(pay("request_gui"));
    left.write(packet);
    left.close();

    const stream = new JsonMessageStream();
    let result = right.read(FRAME_LENGTH_BYTES + 64);
    while (result.kind === "data") {
      stream.feed(result.bytes);
      result = right.read(FRAME_LENGTH_BYTES + 64);
    }
    expect(result).toEqual({ kind: "end" });
    const message = stream.readMessage();
    expect(message).toMatchObject({
      outcome: "message",
      message: { type: "delivery_request", sender: { display_name: "ISHAQ CYBERTECH" } },
    });
    expect(stream.endOfStream()).toEqual({ outcome: "ok" });
  });
});