import { describe, expect, it } from "vitest";

import {
  createDiscoveryRegistry,
  deviceIdentity,
  DISCOVERY_PROBLEMS,
  DISCOVERY_SERVICE_TYPE,
  isDiscoverySupportedVersion,
  parseDiscoveryInfo,
} from "./discovery";
import type { DiscoveryInfo, DiscoveryInfoInput, DiscoveryProblem } from "./discovery";

const fixtures: Record<string, unknown> = require(
  "../../../../protocol/fixtures/model-cases.json",
);

const discovery = fixtures.discovery as {
  service_type: string;
  required_txt_keys: string[];
  peer: DiscoveryInfo;
  peer_with_extra_txt: DiscoveryInfo & { extra_txt_keys: string[] };
  unsupported_version_peer: DiscoveryInfo;
  invalid_discovery_infos: {
    name: string;
    mutations: Record<string, unknown>;
    problem: DiscoveryProblem;
  }[];
  device_identity: { id_format: string };
  events: { event: string; peer: string; note?: string }[];
};

function withMutations(
  base: DiscoveryInfoInput,
  mutations: Record<string, unknown>,
): DiscoveryInfoInput {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(mutations)) {
    if (value === null) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out;
}

describe("phase 05 — discovery foundation", () => {
  it("uses the fixed service type from the protocol specification", () => {
    expect(DISCOVERY_SERVICE_TYPE).toBe("_lanDrop._tcp.local");
    expect(discovery.service_type).toBe(DISCOVERY_SERVICE_TYPE);
    expect(discovery.required_txt_keys).toEqual(["protocol_version", "device_name"]);
  });

  it("parses the canonical discovery information", () => {
    const result = parseDiscoveryInfo(discovery.peer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info).toEqual({
        service: "_lanDrop._tcp.local",
        hostname: "receiver-device.local",
        port: 45821,
        protocol_version: 1,
        device_name: "Android Device",
      });
      expect(isDiscoverySupportedVersion(result.info)).toBe(true);
    }
  });

  it("trims the device display name", () => {
    const result = parseDiscoveryInfo({ ...discovery.peer, device_name: "  Android Device  " });
    expect(result).toEqual({
      ok: true,
      info: { ...discovery.peer, device_name: "Android Device" },
    });
  });

  it("ignores unknown extra TXT keys (forward-compatible metadata)", () => {
    const result = parseDiscoveryInfo(discovery.peer_with_extra_txt);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.info.device_name).toBe("Android Device");
      expect(result.info.port).toBe(45821);
    }
  });

  it("rejects every malformed discovery information case from the fixture", () => {
    for (const ctx of discovery.invalid_discovery_infos) {
      const input = withMutations(discovery.peer, ctx.mutations);
      const result = parseDiscoveryInfo(input);
      expect(result, ctx.name).toEqual({ ok: false, problem: ctx.problem });
    }
  });

  it("accepts an unsupported protocol version as valid metadata but flags it", () => {
    const result = parseDiscoveryInfo(discovery.unsupported_version_peer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(isDiscoverySupportedVersion(result.info)).toBe(false);
    }
  });

  it("exposes only the defined local problem tags", () => {
    expect(DISCOVERY_PROBLEMS).toEqual([
      "INVALID_SERVICE",
      "INVALID_HOSTNAME",
      "INVALID_PORT",
      "INVALID_PROTOCOL_VERSION",
      "INVALID_DEVICE_NAME",
    ]);
  });

  it("registry collapses duplicate advertisements into one logical peer", () => {
    const registry = createDiscoveryRegistry();
    registry.upsert(discovery.peer);
    registry.upsert(discovery.peer);
    registry.upsert(discovery.peer_with_extra_txt);
    expect(registry.size).toBe(1);
    expect(registry.list()[0]?.device_name).toBe("Android Device");
  });

  it("identifies peers by hostname:port", () => {
    expect(deviceIdentity("receiver-device.local", 45821)).toBe("receiver-device.local:45821");
    expect(discovery.device_identity.id_format).toBe("hostname:port");
    const registry = createDiscoveryRegistry();
    registry.upsert(discovery.peer);
    registry.upsert({ ...discovery.peer, hostname: "other-device.local" });
    expect(registry.size).toBe(2);
  });

  it("removes peers on disappearance and starts empty again on reappearance", () => {
    const registry = createDiscoveryRegistry();
    registry.upsert(discovery.peer);
    registry.remove("receiver-device.local", 45821);
    expect(registry.size).toBe(0);
    registry.upsert(discovery.peer);
    expect(registry.size).toBe(1);
  });

  it("clear() shuts discovery down deterministically", () => {
    const registry = createDiscoveryRegistry();
    registry.upsert(discovery.peer);
    registry.upsert({ ...discovery.peer, hostname: "other-device.local" });
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.list()).toEqual([]);
  });
});