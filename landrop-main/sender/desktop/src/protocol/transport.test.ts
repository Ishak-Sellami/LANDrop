import { describe, expect, it } from "vitest";

import { createInMemoryDuplex } from "./transport";

const text = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("InMemoryTransport duplex", () => {
  it("delivers writes to the peer in order", () => {
    const { left, right } = createInMemoryDuplex();
    expect(left.connect()).toEqual({ ok: true });
    expect(right.connect()).toEqual({ ok: true });

    expect(left.write(text("aa"))).toEqual({ ok: true });
    expect(left.write(text("bb"))).toEqual({ ok: true });

    const first = right.read(16);
    expect(first).toMatchObject({ kind: "data" });
    if (first.kind === "data") {
      expect(new TextDecoder().decode(first.bytes)).toBe("aabb");
    }
    expect(right.read(16)).toEqual({ kind: "empty" });
  });

  it("returns empty while open with no data and end after the peer closes", () => {
    const { left, right } = createInMemoryDuplex();
    expect(right.read(4)).toEqual({ kind: "empty" });
    left.close();
    expect(left.write(text("x"))).toMatchObject({ ok: false });
    expect(right.read(4)).toEqual({ kind: "end" });
  });

  it("drains buffered data before reporting end", () => {
    const { left, right } = createInMemoryDuplex();
    left.write(text("payload"));
    left.close();
    expect(right.read(64)).toMatchObject({ kind: "data" });
    expect(right.read(64)).toEqual({ kind: "end" });
  });

  it("respects the maxBytes bound and preserves bytes across reads", () => {
    const { left, right } = createInMemoryDuplex();
    left.write(text("0123456789"));
    expect(right.read(4)).toMatchObject({ kind: "data" });
    const rest = right.read(64);
    expect(rest).toMatchObject({ kind: "data" });
    if (rest.kind === "data") {
      expect(new TextDecoder().decode(rest.bytes)).toBe("456789");
    }
  });

  it("copies writes so the caller may reuse its buffer", () => {
    const { left, right } = createInMemoryDuplex();
    const buf = text("abc");
    left.write(buf);
    buf[0] = 0x58; // 'X' — must not affect the transported copy
    const got = right.read(3);
    expect(got).toMatchObject({ kind: "data" });
    if (got.kind === "data") {
      expect(new TextDecoder().decode(got.bytes)).toBe("abc");
    }
  });

  it("io errors against the closed local end", () => {
    const { left, right } = createInMemoryDuplex();
    left.write(text("x"));
    left.close();
    expect(left.read(4)).toMatchObject({ kind: "error" });
    expect(left.read(4)).toMatchObject({ kind: "error" });
    expect(left.write(text("y"))).toMatchObject({ ok: false });
    expect(left.connect()).toMatchObject({ ok: false });
    expect(left.isClosed).toBe(true);
    // The peer still sees data, then end.
    expect(right.read(4)).toMatchObject({ kind: "data" });
    expect(right.read(4)).toEqual({ kind: "end" });
  });

  it("rejects a non-positive maxBytes", () => {
    const { left } = createInMemoryDuplex();
    expect(left.read(0)).toMatchObject({ kind: "error" });
    expect(left.read(-1)).toMatchObject({ kind: "error" });
  });

  it("close is idempotent", () => {
    const { left, right } = createInMemoryDuplex();
    left.close();
    left.close();
    expect(left.isClosed).toBe(true);
    right.close();
    right.close();
    // Reading on a locally-closed transport is an IO error, not EOF.
    expect(right.read(1)).toMatchObject({ kind: "error" });
  });
});