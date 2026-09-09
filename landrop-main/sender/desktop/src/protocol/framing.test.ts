import { describe, expect, it } from "vitest";

import { decodeFrame, encodeFrame, FrameDecoder, FRAME_LENGTH_BYTES } from "./framing";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const fromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

const framing = fixtures.framing as {
  length_bytes: number;
  byte_order: "big_endian";
  max_payload_bytes: number;
  payloads: Record<string, string>;
  frame_sequence: string[];
  malformed_frames: { name: string; hex: string }[];
  zero_length_frame: string;
};

const pay = (key: string): string => framing.payloads[key] ?? "";

// Encode a payload string and unwrap the success (fixture payloads always fit).
const frameBytes = (s: string): Uint8Array => {
  const encoded = encodeFrame(text(s));
  if (!encoded.ok) throw new Error("unexpected oversized frame");
  return encoded.bytes;
};

describe("fixture parity - framing", () => {
  it("matches the shared framing constants", () => {
    expect(framing.length_bytes).toBe(FRAME_LENGTH_BYTES);
    expect(framing.byte_order).toBe("big_endian");
  });

  it.each(Object.entries(framing.payloads))("encodes/decodes payload %s", (_name, payload) => {
    const encoded = encodeFrame(text(payload));
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      expect(encoded.bytes.length).toBe(FRAME_LENGTH_BYTES + text(payload).length);
      // Big-endian length prefix.
      const length = toHex(encoded.bytes.slice(0, FRAME_LENGTH_BYTES));
      const expected = text(payload).length.toString(16).padStart(8, "0");
      expect(length).toBe(expected);
      const decoded = decodeFrame(encoded.bytes);
      expect(decoded.outcome).toBe("frame");
      if (decoded.outcome === "frame") {
        expect(new TextDecoder().decode(decoded.payload)).toBe(payload);
      }
    }
  });
});

describe("encodeFrame", () => {
  it("carries a zero-length payload", () => {
    const encoded = encodeFrame(new Uint8Array(0));
    expect(encoded.ok).toBe(true);
    if (encoded.ok) {
      expect(toHex(encoded.bytes)).toBe(framing.zero_length_frame);
      const decoded = decodeFrame(encoded.bytes);
      expect(decoded).toEqual({ outcome: "frame", payload: new Uint8Array(0) });
    }
  });

  it("accepts a payload of exactly max_payload_bytes and rejects anything larger", () => {
    const max = framing.max_payload_bytes;
    expect(encodeFrame(new Uint8Array(max)).ok).toBe(true);
    const tooLarge = encodeFrame(new Uint8Array(max + 1));
    expect(tooLarge).toEqual({ ok: false, problem: { code: "FRAME_TOO_LARGE" } });
  });
});

describe("FrameDecoder", () => {
  it("decodes two back-to-back frames from a single feed in order", () => {
    const packet = concat(frameBytes(pay("error_integrity")), frameBytes(pay("response_accept")));
    const done = drain(packet);
    expect(done).toEqual([pay("error_integrity"), pay("response_accept")]);
  });

  it("handles any byte-by-byte split of an encoded frame", () => {
    const payload = pay("error_integrity");
    for (let k = 0; k <= payload.length; k++) {
      const whole = frameBytes(payload);
      const emitted: string[] = [];
      const decoder = new FrameDecoder();
      decoder.feed(whole.slice(0, k));
      let result = decoder.tryReadFrame();
      while (result.outcome === "frame") {
        emitted.push(new TextDecoder().decode(result.payload));
        result = decoder.tryReadFrame();
      }
      expect(result.outcome).toBe("incomplete");
      decoder.feed(whole.slice(k));
      result = decoder.tryReadFrame();
      while (result.outcome === "frame") {
        emitted.push(new TextDecoder().decode(result.payload));
        result = decoder.tryReadFrame();
      }
      expect(result.outcome).toBe("incomplete");
      expect(emitted).toEqual([payload]);
      expect(decoder.endOfStream()).toEqual({ outcome: "ok" });
    }
  });

  it.each(["truncated_header", "truncated_body"])(
    "treats trailing %s as truncated at end of stream",
    (name) => {
      const hex = framing.malformed_frames.find((f) => f.name === name)?.hex ?? "";
      const decoder = new FrameDecoder();
      decoder.feed(fromHex(hex));
      let result = decoder.tryReadFrame();
      if (result.outcome === "frame") {
        result = decoder.tryReadFrame();
      }
      expect(result.outcome).toBe("incomplete");
      expect(decoder.endOfStream()).toEqual({ outcome: "error", problem: { code: "TRUNCATED" } });
    },
  );

  it.each(["oversized_length", "wild_length"])("rejects %s with FRAME_TOO_LARGE", (name) => {
    const hex = framing.malformed_frames.find((f) => f.name === name)?.hex ?? "";
    const decoder = new FrameDecoder();
    decoder.feed(fromHex(hex));
    expect(decoder.tryReadFrame()).toEqual({
      outcome: "error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
    // Deterministic: the error repeats and later input cannot change it.
    expect(decoder.tryReadFrame()).toEqual({
      outcome: "error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
    expect(decoder.endOfStream()).toEqual({
      outcome: "error",
      problem: { code: "FRAME_TOO_LARGE" },
    });
  });

  it("conserves bytes across arbitrary chunk splits", () => {
    const a = pay("error_integrity");
    const b = pay("response_accept");
    const packet = concat(frameBytes(a), frameBytes(b));
    const decoder = new FrameDecoder();
    // Feed one byte at a time, always draining warm frames.
    const emitted: string[] = [];
    for (let i = 0; i < packet.length; i++) {
      decoder.feed(packet.slice(i, i + 1));
      let result = decoder.tryReadFrame();
      while (result.outcome === "frame") {
        emitted.push(new TextDecoder().decode(result.payload));
        result = decoder.tryReadFrame();
      }
    }
    expect(emitted).toEqual([a, b]);
    expect(decoder.emittedFrameCount).toBe(2);
    expect(decoder.emittedPayloadBytes).toBe(text(a).length + text(b).length);
    expect(decoder.isBalanced).toBe(true);
  });

  it("empty input is not a problem", () => {
    const decoder = new FrameDecoder();
    expect(decoder.tryReadFrame().outcome).toBe("incomplete");
    expect(decoder.endOfStream()).toEqual({ outcome: "ok" });
  });
});

function concat(...buffers: Uint8Array[]): Uint8Array {
  const total = buffers.reduce((sum, b) => sum + b.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const b of buffers) {
    out.set(b, offset);
    offset += b.length;
  }
  return out;
}

function drain(packet: Uint8Array): string[] {
  const decoder = new FrameDecoder();
  decoder.feed(packet);
  const out: string[] = [];
  let result = decoder.tryReadFrame();
  while (result.outcome === "frame") {
    out.push(new TextDecoder().decode(result.payload));
    result = decoder.tryReadFrame();
  }
  expect(result.outcome).toBe("incomplete");
  expect(decoder.endOfStream()).toEqual({ outcome: "ok" });
  return out;
}