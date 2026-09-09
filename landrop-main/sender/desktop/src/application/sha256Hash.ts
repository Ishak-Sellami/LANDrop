// Platform SHA-256 — streaming digest computation for the desktop host seam.
// Feeds chunks into Node's standard `crypto` (`createHash("sha256")`) without
// buffering the whole artifact, then emits the digest as lowercase hex (the
// representation the shared Integrity module compares).
//
// NODE-ONLY: this module imports `node:crypto` and must NEVER be reached from
// the renderer/vite bundle (it would break browser builds). Nothing in the
// protocol or presentation graph imports it in Phase 07; only the desktop host
// seam and tests do. The Android receiver computes the same digest with JVM
// MessageDigest (receiver/android/.../platform/Sha256Stream.kt); the future
// Rust sender seam would use RustCrypto `sha2`.
//
// Mirrors receiver/android/.../platform/Sha256Stream.kt chunk-stream semantics.

import { createHash } from "node:crypto";

export type ByteSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array>;

async function* toAsync(source: ByteSource): AsyncIterable<Uint8Array> {
  if ((source as Iterable<Uint8Array>)[Symbol.iterator] !== undefined) {
    for (const chunk of source as Iterable<Uint8Array>) {
      yield chunk;
    }
  } else {
    yield* (source as AsyncIterable<Uint8Array>);
  }
}

export async function sha256Hex(source: ByteSource): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of toAsync(source)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}