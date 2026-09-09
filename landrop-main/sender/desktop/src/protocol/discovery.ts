// Discovery foundation (protocol spec §4, project spec §16, architecture §27).
// Deterministic parsing/validation of mDNS/DNS-SD service information plus a
// device registry. The platform seam (NSD on Android, mDNS browser in Rust)
// feeds raw records here; this module never performs I/O.
// Discovery is informational only and does not authenticate a device.

import { CURRENT_PROTOCOL_VERSION } from "./types";

// Fixed service type for LanDrop v1 (protocol spec §4).
export const DISCOVERY_SERVICE_TYPE = "_lanDrop._tcp.local";

// Local problem tags for malformed discovery metadata. These are NOT wire
// ErrorCodes; the peer is simply excluded from the device list.
export type DiscoveryProblem =
  | "INVALID_SERVICE"
  | "INVALID_HOSTNAME"
  | "INVALID_PORT"
  | "INVALID_PROTOCOL_VERSION"
  | "INVALID_DEVICE_NAME";

export const DISCOVERY_PROBLEMS: readonly DiscoveryProblem[] = [
  "INVALID_SERVICE",
  "INVALID_HOSTNAME",
  "INVALID_PORT",
  "INVALID_PROTOCOL_VERSION",
  "INVALID_DEVICE_NAME",
];

export interface DiscoveryInfo {
  readonly service: string;
  readonly hostname: string;
  readonly port: number;
  readonly protocol_version: number;
  readonly device_name: string;
}

export type DiscoveryParseResult =
  | { readonly ok: true; readonly info: DiscoveryInfo }
  | { readonly ok: false; readonly problem: DiscoveryProblem };

// Raw record from the platform seam (or a previously parsed DiscoveryInfo for
// re-validation). Unknown extra TXT keys are ignored (forward-compatible;
// project §16 lists optional metadata we do not model).
export type DiscoveryInfoInput =
  | Readonly<Record<string, unknown>>
  | Readonly<DiscoveryInfo>;

function fieldsOf(input: DiscoveryInfoInput): Readonly<Record<string, unknown>> {
  return input as Readonly<Record<string, unknown>>;
}

function readStringField(input: DiscoveryInfoInput, key: string): string | undefined {
  const value = fieldsOf(input)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumberField(input: DiscoveryInfoInput, key: string): number | undefined {
  const value = fieldsOf(input)[key];
  return typeof value === "number" ? value : undefined;
}

// Hostnames travel the local network untouched; reject anything that could be
// used to smuggle a path (project spec §36: network-provided names must never
// be concatenated into paths).
function isValidHostname(hostname: string): boolean {
  if (hostname.length === 0) return false;
  return !/[\s/\\]/.test(hostname);
}

export function parseDiscoveryInfo(input: DiscoveryInfoInput): DiscoveryParseResult {
  const service = readStringField(input, "service");
  if (service === undefined || service !== DISCOVERY_SERVICE_TYPE) {
    return { ok: false, problem: "INVALID_SERVICE" };
  }
  const hostname = readStringField(input, "hostname");
  if (hostname === undefined || !isValidHostname(hostname)) {
    return { ok: false, problem: "INVALID_HOSTNAME" };
  }
  const port = readNumberField(input, "port");
  if (port === undefined || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return { ok: false, problem: "INVALID_PORT" };
  }
  const protocol_version = readNumberField(input, "protocol_version");
  if (protocol_version === undefined || !Number.isSafeInteger(protocol_version)) {
    return { ok: false, problem: "INVALID_PROTOCOL_VERSION" };
  }
  const deviceNameRaw = readStringField(input, "device_name");
  const device_name = deviceNameRaw === undefined ? undefined : deviceNameRaw.trim();
  if (device_name === undefined || device_name.length === 0) {
    return { ok: false, problem: "INVALID_DEVICE_NAME" };
  }
  const info: DiscoveryInfo = {
    service,
    hostname,
    port,
    protocol_version,
    device_name,
  };
  return { ok: true, info };
}

export function isDiscoverySupportedVersion(info: DiscoveryInfo): boolean {
  return info.protocol_version === CURRENT_PROTOCOL_VERSION;
}

// A discovered peer is identified by its resolved host and port. No separate
// device identifier is defined by the protocol; session/request IDs remain
// the only protocol-level identifiers.
export function deviceIdentity(hostname: string, port: number): string {
  return `${hostname}:${port}`;
}

export interface DiscoveredDevice {
  readonly identity: string;
  readonly hostname: string;
  readonly port: number;
  readonly protocol_version: number;
  readonly device_name: string;
  readonly supported: boolean;
}

export interface DiscoveryRegistry {
  readonly size: number;
  upsert(info: DiscoveryInfo): void;
  remove(hostname: string, port: number): void;
  clear(): void;
  list(): readonly DiscoveredDevice[];
}

// Deterministic in-memory device list. Duplicate advertisements collapse to a
// single logical entry (identity = hostname:port). No TTL is invented: peers
// leave the list only through an explicit disappearance signal (removal) or
// shutdown (clear).
export function createDiscoveryRegistry(): DiscoveryRegistry {
  const entries = new Map<string, DiscoveredDevice>();
  return {
    get size(): number {
      return entries.size;
    },
    upsert(info: DiscoveryInfo): void {
      const device: DiscoveredDevice = {
        identity: deviceIdentity(info.hostname, info.port),
        hostname: info.hostname,
        port: info.port,
        protocol_version: info.protocol_version,
        device_name: info.device_name,
        supported: isDiscoverySupportedVersion(info),
      };
      entries.set(device.identity, device);
    },
    remove(hostname: string, port: number): void {
      entries.delete(deviceIdentity(hostname, port));
    },
    clear(): void {
      entries.clear();
    },
    list(): readonly DiscoveredDevice[] {
      return [...entries.values()];
    },
  };
}