import { describe, expect, it } from "vitest";

import { classifyVerification, hashesMatch, isValidSha256 } from "./integrity";
import { sha256Hex } from "../application/sha256Hash";

// ---------------------------------------------------------------------------
// Shared fixtures (deterministic, consumed by every mirror stack)
// ---------------------------------------------------------------------------

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const INTEGRITY = fixtures.integrity as {
  algorithm: string;
  digest_format: string;
  expected_digest_source: string;
  digest_computation: string;
  known_hashes: {
    empty: string;
    ascii_abc: string;
    ascii_hello: string;
  };
  verdicts: {
    name: string;
    expected: string;
    actual: string;
    verdict: "VERIFIED" | "INTEGRITY_MISMATCH";
  }[];
};

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Representation & validation (shared pure behavior)
// ---------------------------------------------------------------------------

describe("integrity — digest validation", () => {
  it("accepts 64 hex characters in either case", () => {
    expect(isValidSha256(INTEGRITY.known_hashes.ascii_abc)).toBe(true);
    expect(isValidSha256(INTEGRITY.known_hashes.ascii_abc.toUpperCase())).toBe(true);
  });

  it("accepts the exact 64-char zero-hex digest", () => {
    expect(isValidSha256("0000000000000000000000000000000000000000000000000000000000000000")).toBe(true);
  });

  it("rejects anything that is not 64 hex characters", () => {
    for (const bad of [
      "",
      "abc",
      "a".repeat(63),
      "a".repeat(65),
      " ".repeat(64),
      "g".repeat(64),
      "zz".repeat(32),
      "É".repeat(64),
      "0123 " + "a".repeat(60),
    ]) {
      expect(isValidSha256(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("integrity — fixture contract", () => {
  it("declares the standard SHA-256 digest representation", () => {
    expect(INTEGRITY.algorithm).toBe("SHA-256");
    expect(INTEGRITY.expected_digest_source).toBe(
      "delivery_request.application.sha256",
    );
    expect(INTEGRITY.digest_computation).toContain("platform-provided");
  });

  it("every known hash is a valid 64-hex digest", () => {
    for (const hash of Object.values(INTEGRITY.known_hashes)) {
      expect(isValidSha256(hash)).toBe(true);
    }
  });

  it("every verdict row is internally consistent", () => {
    for (const row of INTEGRITY.verdicts) {
      expect(isValidSha256(row.expected)).toBe(true);
      expect(isValidSha256(row.actual)).toBe(true);
      expect(classifyVerification(row.expected, row.actual)).toBe(row.verdict);
    }
  });
});

// ---------------------------------------------------------------------------
// Comparison (protocol §21)
// ---------------------------------------------------------------------------

describe("integrity — hashesMatch is case-insensitive and validated", () => {
  it("matches identical and case-differing digests", () => {
    const abc = INTEGRITY.known_hashes.ascii_abc;
    expect(hashesMatch(abc, abc)).toBe(true);
    expect(hashesMatch(abc.toUpperCase(), abc)).toBe(true);
    expect(hashesMatch(abc, abc.toUpperCase())).toBe(true);
  });

  it("does not match different digests", () => {
    expect(
      hashesMatch(INTEGRITY.known_hashes.ascii_abc, INTEGRITY.known_hashes.empty),
    ).toBe(false);
  });

  it("returns false whenever either input is not a valid digest", () => {
    const abc = INTEGRITY.known_hashes.ascii_abc;
    expect(hashesMatch("not-a-digest", abc)).toBe(false);
    expect(hashesMatch(abc, "")).toBe(false);
    expect(hashesMatch("", "")).toBe(false);
  });
});

describe("integrity — classifyVerification follows the protocol truth table", () => {
  it("equal digests classify as VERIFIED", () => {
    const abc = INTEGRITY.known_hashes.ascii_abc;
    expect(classifyVerification(abc, abc)).toBe("VERIFIED");
    expect(classifyVerification(abc.toUpperCase(), abc)).toBe("VERIFIED");
  });

  it("different digests classify as INTEGRITY_MISMATCH", () => {
    expect(
      classifyVerification(INTEGRITY.known_hashes.ascii_abc, INTEGRITY.known_hashes.empty),
    ).toBe("INTEGRITY_MISMATCH");
  });
});

// ---------------------------------------------------------------------------
// Digest computation (platform seam, executable reference)
// ---------------------------------------------------------------------------

describe("integrity — sha256Hex matches known vectors", () => {
  it("empty input produces the canonical empty digest", async () => {
    expect(await sha256Hex([])).toBe(INTEGRITY.known_hashes.empty);
  });

  it("ascii inputs produce the shared fixture vectors", async () => {
    for (const [input, expected] of [
      ["abc", INTEGRITY.known_hashes.ascii_abc],
      ["hello", INTEGRITY.known_hashes.ascii_hello],
    ] as const) {
      expect(await sha256Hex([encoder.encode(input)])).toBe(expected);
    }
  });

  it("multi-chunk streaming equals single-chunk hashing", async () => {
    const abc = INTEGRITY.known_hashes.ascii_abc;
    const bytes = encoder.encode("abc");
    const oneShot = await sha256Hex([bytes]);
    const chunked = await sha256Hex([bytes.subarray(0, 1), bytes.subarray(1)]);
    expect(oneShot).toBe(abc);
    expect(chunked).toBe(abc);
  });

  it("async sources are supported identically", async () => {
    async function* source(): AsyncIterable<Uint8Array> {
      yield encoder.encode("a");
      yield encoder.encode("bc");
    }
    expect(await sha256Hex(source())).toBe(INTEGRITY.known_hashes.ascii_abc);
  });

  it("the declared expected digest is a well-formed hash", () => {
    const request = fixtures.delivery_request as { application: { sha256: string } };
    expect(isValidSha256(request.application.sha256)).toBe(true);
  });
});