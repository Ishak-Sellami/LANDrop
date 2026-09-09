// Wire framing — 4-byte big-endian length prefix + JSON payload.
// The protocol spec does not define a frame structure (SPECIFICATION GAP,
// resolved here and fixed in the shared fixtures). max_payload_bytes reuses
// the codec's maxJsonBytes (65536) so no new magic numbers appear.
// A framing problem is a LOCAL defect (corrupt/oversized/truncated stream),
// never a wire ErrorCode.

import { DEFAULT_LIMITS } from "./codec";

export const FRAME_LENGTH_BYTES = 4;
export const FRAME_BYTE_ORDER = "big_endian" as const;
export const MAX_FRAME_PAYLOAD_BYTES = DEFAULT_LIMITS.maxJsonBytes;

export type FrameProblem =
  | { readonly code: "FRAME_TOO_LARGE" }
  | { readonly code: "TRUNCATED" };

export type FrameResult =
  | { readonly outcome: "frame"; readonly payload: Uint8Array }
  | { readonly outcome: "incomplete" }
  | { readonly outcome: "error"; readonly problem: FrameProblem };

export type FrameEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly problem: FrameProblem };

export function encodeFrame(payload: Uint8Array): FrameEncodeResult {
  if (payload.length > MAX_FRAME_PAYLOAD_BYTES) {
    return { ok: false, problem: { code: "FRAME_TOO_LARGE" } };
  }
  const bytes = new Uint8Array(FRAME_LENGTH_BYTES + payload.length);
  bytes[0] = (payload.length >>> 24) & 0xff;
  bytes[1] = (payload.length >>> 16) & 0xff;
  bytes[2] = (payload.length >>> 8) & 0xff;
  bytes[3] = payload.length & 0xff;
  bytes.set(payload, FRAME_LENGTH_BYTES);
  return { ok: true, bytes };
}

export function decodeFrame(bytes: Uint8Array): FrameResult {
  const decoder = new FrameDecoder();
  decoder.feed(bytes);
  return decoder.tryReadFrame();
}

function readUint32BE(b: Uint8Array, offset: number): number {
  return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(offset, false);
}

// Incremental frame assembler. Feed the stream in any chunk split; call
// tryReadFrame() repeatedly until incomplete; call endOfStream() once the
// peer EOFs to surface a trailing TRUNCATED frame (message boundaries are
// length-defined, so trailing bytes always mean a broken stream).
export class FrameDecoder {
  private readonly chunks: Uint8Array[] = [];
  private buffered = 0;
  private broken: FrameProblem | null = null;
  private fedBytes = 0;
  private emittedHeaders = 0;
  private emittedPayload = 0;

  constructor(private readonly maxPayloadBytes: number = MAX_FRAME_PAYLOAD_BYTES) {}

  get totalFedBytes(): number {
    return this.fedBytes;
  }

  get emittedFrameCount(): number {
    return this.emittedHeaders / FRAME_LENGTH_BYTES;
  }

  get emittedPayloadBytes(): number {
    return this.emittedPayload;
  }

  get bufferedBytes(): number {
    return this.buffered;
  }

  // Conservation invariant: totalFedBytes ===
  // emittedFrameCount * FRAME_LENGTH_BYTES + emittedPayloadBytes + bufferedBytes.
  get isBalanced(): boolean {
    return (
      this.fedBytes ===
      this.emittedHeaders + this.emittedPayload + this.buffered
    );
  }

  feed(chunk: Uint8Array): void {
    if (chunk.length === 0) return;
    this.fedBytes += chunk.length;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
  }

  private peek(n: number): Uint8Array | null {
    if (this.buffered < n) return null;
    const out = new Uint8Array(n);
    let remaining = n;
    let index = 0;
    while (remaining > 0) {
      const head = this.chunks[index];
      if (head === undefined || head.length === 0) {
        index++;
        continue;
      }
      const take = Math.min(head.length, remaining);
      out.set(head.subarray(0, take), n - remaining);
      remaining -= take;
      if (take === head.length) index++;
    }
    return out;
  }

  private drop(n: number): void {
    let remaining = n;
    while (remaining > 0) {
      const head = this.chunks[0];
      if (head === undefined || head.length === 0) {
        this.chunks.shift();
        continue;
      }
      if (head.length <= remaining) {
        remaining -= head.length;
        this.chunks.shift();
      } else {
        this.chunks[0] = head.subarray(remaining);
        remaining = 0;
      }
    }
    this.buffered -= n;
  }

  tryReadFrame(): FrameResult {
    if (this.broken !== null) return { outcome: "error", problem: this.broken };
    const header = this.peek(FRAME_LENGTH_BYTES);
    if (header === null) return { outcome: "incomplete" };
    const length = readUint32BE(header, 0);
    if (length > this.maxPayloadBytes) {
      if (this.broken === null) this.broken = { code: "FRAME_TOO_LARGE" };
      return { outcome: "error", problem: this.broken };
    }
    if (this.buffered < FRAME_LENGTH_BYTES + length) {
      return { outcome: "incomplete" };
    }
    this.drop(FRAME_LENGTH_BYTES);
    const payload = this.peek(length);
    if (payload === null) {
      // Unreachable: the buffered check above guarantees the bytes are present.
      this.broken = { code: "TRUNCATED" };
      return { outcome: "error", problem: this.broken };
    }
    this.drop(length);
    this.emittedHeaders += FRAME_LENGTH_BYTES;
    this.emittedPayload += length;
    return { outcome: "frame", payload };
  }

  endOfStream(): { outcome: "ok" } | { outcome: "error"; problem: FrameProblem } {
    if (this.broken !== null) return { outcome: "error", problem: this.broken };
    if (this.buffered > 0) return { outcome: "error", problem: { code: "TRUNCATED" } };
    return { outcome: "ok" };
  }
}