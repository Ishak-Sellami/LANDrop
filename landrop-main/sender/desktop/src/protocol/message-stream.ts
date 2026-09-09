// Message boundary: transport bytes -> frames -> codec -> protocol messages.
// This is where the abstract Transport meets the Phase 02 codec. It is
// transport-agnostic: callers feed bytes (e.g. from Transport.read) and read
// complete ControlMessages out the other side.

import { decodeMessage, encodeMessage, ProtocolProblem, DEFAULT_LIMITS } from "./codec";
import type { Limits } from "./codec";
import { FrameDecoder, encodeFrame, MAX_FRAME_PAYLOAD_BYTES } from "./framing";
import type { FrameProblem } from "./framing";
import type { ControlMessage } from "./types";

export type JsonMessageResult =
  | { readonly outcome: "message"; readonly message: ControlMessage }
  | { readonly outcome: "incomplete" }
  | { readonly outcome: "frame-error"; readonly problem: FrameProblem }
  | { readonly outcome: "protocol-error"; readonly problem: ProtocolProblem }
  | { readonly outcome: "end" };

export type StreamEndResult =
  | { readonly outcome: "ok" }
  | { readonly outcome: "frame-error"; readonly problem: FrameProblem };

export class JsonMessageStream {
  private readonly decoder: FrameDecoder;

  constructor(
    private readonly limits: Limits = DEFAULT_LIMITS,
    maxFramePayloadBytes: number = MAX_FRAME_PAYLOAD_BYTES,
  ) {
    this.decoder = new FrameDecoder(maxFramePayloadBytes);
  }

  feed(chunk: Uint8Array): void {
    this.decoder.feed(chunk);
  }

  readMessage(): JsonMessageResult {
    const frame = this.decoder.tryReadFrame();
    switch (frame.outcome) {
      case "incomplete":
        return { outcome: "incomplete" };
      case "error":
        return { outcome: "frame-error", problem: frame.problem };
      default: {
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(frame.payload);
        } catch {
          // Non-UTF-8 payload: normalize into the codec's malformed-JSON
          // problem rather than leaking a raw decoder exception (§10).
          return { outcome: "protocol-error", problem: new ProtocolProblem("INVALID_REQUEST", "json") };
        }
        try {
          return { outcome: "message", message: decodeMessage(text, this.limits) };
        } catch (cause) {
          if (cause instanceof ProtocolProblem) {
            return { outcome: "protocol-error", problem: cause };
          }
          throw cause;
        }
      }
    }
  }

  endOfStream(): StreamEndResult {
    const result = this.decoder.endOfStream();
    if (result.outcome === "error") {
      return { outcome: "frame-error", problem: result.problem };
    }
    return result;
  }

  get bufferedBytes(): number {
    return this.decoder.bufferedBytes;
  }

  get isBalanced(): boolean {
    return this.decoder.isBalanced;
  }
}

export type JsonFrameEncodeResult =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly problem: ProtocolProblem | FrameProblem };

// Encode a typed message into a single wire frame (JSON payload). The codec
// already bounds the JSON at maxJsonBytes, which equals the frame payload
// limit, so a validated message always fits one frame.
export function encodeJsonFrame(
  message: ControlMessage,
  limits: Limits = DEFAULT_LIMITS,
): JsonFrameEncodeResult {
  try {
    const json = encodeMessage(message, limits);
    const encoded = encodeFrame(new TextEncoder().encode(json));
    if (!encoded.ok) return { ok: false, problem: encoded.problem };
    return { ok: true, bytes: encoded.bytes };
  } catch (cause) {
    if (cause instanceof ProtocolProblem) {
      return { ok: false, problem: cause };
    }
    throw cause;
  }
}