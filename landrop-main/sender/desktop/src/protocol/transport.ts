// Transport abstraction (architecture §29 / §30) — foundation only.
// Prevents UI/control code from assuming any concrete networking stack
// (direct TCP/TLS is deferred; see repo §41 Dependency Boundaries).
// The in-memory duplex pair is a deterministic TEST SEAM, not a product
// transport choice. No sockets, TLS, or mDNS here.

export type TransportErrorKind = "CONNECTION_LOST" | "TIMEOUT" | "IO_ERROR";

export interface TransportFailure {
  readonly kind: TransportErrorKind;
  readonly message: string;
}

export type TransportResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: TransportFailure };

// Read yields buffered bytes (data), the peer's end of stream once drained
// (end), or no data right now without implying EOF (empty).
export type TransportRead =
  | { readonly kind: "data"; readonly bytes: Uint8Array }
  | { readonly kind: "empty" }
  | { readonly kind: "end" }
  | { readonly kind: "error"; readonly error: TransportFailure };

export type TransportWrite =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: TransportFailure };

export interface Transport {
  connect(): TransportResult;
  read(maxBytes: number): TransportRead;
  write(bytes: Uint8Array): TransportWrite;
  close(): void;
  /** True once close() has been called on this side. */
  readonly isClosed: boolean;
}

function ioError(message: string): TransportFailure {
  return { kind: "IO_ERROR", message };
}

interface InboundBuffer {
  readonly chunks: Uint8Array[];
  size: number;
  /** True once the peer that feeds this buffer has closed its side. */
  peerClosed: boolean;
}

class InMemoryEndpoint implements Transport {
  private closed = false;

  constructor(
    private readonly incoming: InboundBuffer,
    private readonly outgoing: InboundBuffer,
    private readonly markPeerClosed: () => void,
  ) {}

  connect(): TransportResult {
    if (this.closed) return { ok: false, error: ioError("connect on closed transport") };
    return { ok: true };
  }

  get isClosed(): boolean {
    return this.closed;
  }

  read(maxBytes: number): TransportRead {
    if (this.closed) return { kind: "error", error: ioError("read on closed transport") };
    if (maxBytes <= 0) return { kind: "error", error: ioError("read requires maxBytes > 0") };
    const inbound = this.incoming;
    if (inbound.size > 0) {
      const out = new Uint8Array(Math.min(maxBytes, inbound.size));
      let index = 0;
      while (index < out.length) {
        const head = inbound.chunks[0];
        if (head === undefined || head.length === 0) {
          inbound.chunks.shift();
          continue;
        }
        const take = Math.min(head.length, out.length - index);
        out.set(head.subarray(0, take), index);
        if (take === head.length) {
          inbound.chunks.shift();
        } else {
          inbound.chunks[0] = head.subarray(take);
        }
        index += take;
      }
      inbound.size -= out.length;
      return { kind: "data", bytes: out };
    }
    if (inbound.peerClosed) return { kind: "end" };
    return { kind: "empty" };
  }

  write(bytes: Uint8Array): TransportWrite {
    if (this.closed) return { ok: false, error: ioError("write on closed transport") };
    this.outgoing.chunks.push(bytes.slice());
    this.outgoing.size += bytes.length;
    return { ok: true };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.markPeerClosed();
  }
}

export interface DuplexTransport {
  readonly left: Transport;
  readonly right: Transport;
}

// Deterministic in-memory pipe for tests and offline integration. left writes
// into the buffer right reads and vice versa; closing one end surfaces as
// "end" on the other once its buffer drains.
export function createInMemoryDuplex(): DuplexTransport {
  const toLeft: InboundBuffer = { chunks: [], size: 0, peerClosed: false };
  const toRight: InboundBuffer = { chunks: [], size: 0, peerClosed: false };
  const left = new InMemoryEndpoint(toLeft, toRight, () => {
    toRight.peerClosed = true;
  });
  const right = new InMemoryEndpoint(toRight, toLeft, () => {
    toLeft.peerClosed = true;
  });
  return { left, right };
}