// Discovery foundation (protocol spec §4, project spec §16, architecture §27).
// Deterministic parsing/validation of mDNS/DNS-SD service information plus a
// device registry. The platform seam (NSD on Android, an mdns aggregator on
// desktop) feeds raw records here; this module never performs I/O.
// Discovery is informational only and does not authenticate a device.

use std::collections::BTreeMap;

use super::CURRENT_PROTOCOL_VERSION;

// Fixed service type for LanDrop v1 (protocol spec §4).
pub const DISCOVERY_SERVICE_TYPE: &str = "_lanDrop._tcp.local";

// Local problem tags for malformed discovery metadata. These are NOT wire
// ErrorCodes; the peer is simply excluded from the device list.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiscoveryProblem {
    InvalidService,
    InvalidHostname,
    InvalidPort,
    InvalidProtocolVersion,
    InvalidDeviceName,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveryInfo {
    pub service: String,
    pub hostname: String,
    pub port: u16,
    pub protocol_version: i32,
    pub device_name: String,
}

// Raw record materialized by the local discovery seam into typed fields.
// Unknown extra TXT keys are carried but ignored (forward-compatible;
// project §16 lists optional metadata we do not model).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawDiscoveryInfo {
    pub service: String,
    pub hostname: String,
    pub port: i64,
    pub protocol_version: i64,
    pub device_name: String,
    pub extra_txt: Vec<(String, String)>,
}

// Hostnames travel the local network untouched; reject anything that could be
// used to smuggle a path (project spec §36: network-provided names must never
// be concatenated into paths).
fn hostname_valid(hostname: &str) -> bool {
    if hostname.is_empty() {
        return false;
    }
    !hostname
        .chars()
        .any(|c| c.is_whitespace() || c == '/' || c == '\\')
}

pub fn parse_discovery_info(raw: RawDiscoveryInfo) -> Result<DiscoveryInfo, DiscoveryProblem> {
    let _ = raw.extra_txt; // optional metadata ignored (forward-compatible)
    if raw.service != DISCOVERY_SERVICE_TYPE {
        return Err(DiscoveryProblem::InvalidService);
    }
    if !hostname_valid(&raw.hostname) {
        return Err(DiscoveryProblem::InvalidHostname);
    }
    if raw.port < 1 || raw.port > 65535 {
        return Err(DiscoveryProblem::InvalidPort);
    }
    let Ok(protocol_version) = i32::try_from(raw.protocol_version) else {
        return Err(DiscoveryProblem::InvalidProtocolVersion);
    };
    let device_name = raw.device_name.trim();
    if device_name.is_empty() {
        return Err(DiscoveryProblem::InvalidDeviceName);
    }
    Ok(DiscoveryInfo {
        service: raw.service,
        hostname: raw.hostname,
        port: raw.port as u16,
        protocol_version,
        device_name: device_name.to_string(),
    })
}

pub fn is_discovery_supported_version(info: &DiscoveryInfo) -> bool {
    info.protocol_version == CURRENT_PROTOCOL_VERSION
}

// A discovered peer is identified by its resolved host and port. No separate
// device identifier is defined by the protocol; session/request IDs remain
// the only protocol-level identifiers.
pub fn device_identity(hostname: &str, port: u16) -> String {
    format!("{}:{}", hostname, port)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiscoveredDevice {
    pub identity: String,
    pub hostname: String,
    pub port: u16,
    pub protocol_version: i32,
    pub device_name: String,
    pub supported: bool,
}

// Deterministic in-memory device list. Duplicate advertisements collapse to a
// single logical entry (identity = hostname:port). No TTL is invented: peers
// leave the list only through an explicit disappearance signal (removal) or
// shutdown (clear).
#[derive(Debug, Default)]
pub struct DiscoveryRegistry {
    entries: BTreeMap<String, DiscoveredDevice>,
}

impl DiscoveryRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn size(&self) -> usize {
        self.entries.len()
    }

    pub fn upsert(&mut self, info: DiscoveryInfo) {
    let supported = is_discovery_supported_version(&info);

    let device = DiscoveredDevice {
        identity: device_identity(&info.hostname, info.port),
        hostname: info.hostname,
        port: info.port,
        protocol_version: info.protocol_version,
        device_name: info.device_name,
        supported,
        };

        self.entries.insert(device.identity.clone(), device);
    }

    pub fn remove(&mut self, hostname: &str, port: u16) {
        self.entries.remove(&device_identity(hostname, port));
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn list(&self) -> Vec<DiscoveredDevice> {
        self.entries.values().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical() -> RawDiscoveryInfo {
        RawDiscoveryInfo {
            service: DISCOVERY_SERVICE_TYPE.to_string(),
            hostname: "receiver-device.local".to_string(),
            port: 45821,
            protocol_version: 1,
            device_name: "Android Device".to_string(),
            extra_txt: vec![("lanDrop_version".into(), "0.1.0".into())],
        }
    }

    fn raw(mut mutations: Vec<(&str, Option<String>)>) -> RawDiscoveryInfo {
        let mut base = canonical();
        for (key, value) in mutations.drain(..) {
            match key {
                "service" => base.service = value.unwrap_or_default(),
                "hostname" => base.hostname = value.unwrap_or_default(),
                "port" => {
                    let v = value.unwrap_or_default();
                    base.port = if v.is_empty() { -1 } else { v.parse().unwrap_or(-1) };
                }
                "protocol_version" => {
                    base.protocol_version = match value {
                        Some(v) if v == "fractional" => i64::MAX, // out of i32 range at the seam
                        Some(v) => v.parse().unwrap_or(i64::MIN),
                        None => i64::MIN,
                    };
                }
                "device_name" => base.device_name = value.unwrap_or_default(),
                _ => {}
            }
        }
        base
    }

    #[test]
    fn service_type_matches_specification() {
        assert_eq!(DISCOVERY_SERVICE_TYPE, "_lanDrop._tcp.local");
    }

    #[test]
    fn parses_canonical_discovery_information() {
        let info = parse_discovery_info(canonical()).unwrap();
        assert_eq!(info.service, "_lanDrop._tcp.local");
        assert_eq!(info.hostname, "receiver-device.local");
        assert_eq!(info.port, 45821);
        assert_eq!(info.protocol_version, 1);
        assert_eq!(info.device_name, "Android Device");
        assert!(is_discovery_supported_version(&info));
    }

    #[test]
    fn trims_the_device_display_name() {
        let mut c = canonical();
        c.device_name = "  Android Device  ".to_string();
        assert_eq!(parse_discovery_info(c).unwrap().device_name, "Android Device");
    }

    #[test]
    fn rejects_every_malformed_case() {
        let cases: Vec<(Vec<(&str, Option<String>)>, DiscoveryProblem)> = vec![
            (vec![("service", Some("_other._tcp.local".into()))], DiscoveryProblem::InvalidService),
            (vec![("hostname", Some("a b".into()))], DiscoveryProblem::InvalidHostname),
            (vec![("hostname", Some("a/b".into()))], DiscoveryProblem::InvalidHostname),
            (vec![("hostname", Some("a\\b".into()))], DiscoveryProblem::InvalidHostname),
            (vec![("hostname", Some("".into()))], DiscoveryProblem::InvalidHostname),
            (vec![("port", Some("0".into()))], DiscoveryProblem::InvalidPort),
            (vec![("port", Some("65536".into()))], DiscoveryProblem::InvalidPort),
            (vec![("protocol_version", Some("fractional".into()))], DiscoveryProblem::InvalidProtocolVersion),
            (vec![("protocol_version", None)], DiscoveryProblem::InvalidProtocolVersion),
            (vec![("device_name", Some("".into()))], DiscoveryProblem::InvalidDeviceName),
            (vec![("device_name", Some("   ".into()))], DiscoveryProblem::InvalidDeviceName),
        ];
        for (mutations, problem) in cases {
            assert_eq!(parse_discovery_info(raw(mutations)), Err(problem));
        }
    }

    #[test]
    fn accepts_unsupported_version_as_valid_metadata_but_flags_it() {
        for version in [2i64, 0, -1] {
            let mut c = canonical();
            c.protocol_version = version;
            let info = parse_discovery_info(c).unwrap();
            assert!(!is_discovery_supported_version(&info), "version {version}");
        }
    }

    #[test]
    fn registry_collapses_duplicate_advertisements() {
        let mut registry = DiscoveryRegistry::new();
        registry.upsert(parse_discovery_info(canonical()).unwrap());
        registry.upsert(parse_discovery_info(canonical()).unwrap());
        assert_eq!(registry.size(), 1);
        assert_eq!(registry.list()[0].device_name, "Android Device");
    }

    #[test]
    fn identifies_peers_by_hostname_port() {
        assert_eq!(device_identity("receiver-device.local", 45821), "receiver-device.local:45821");
        let mut registry = DiscoveryRegistry::new();
        registry.upsert(parse_discovery_info(canonical()).unwrap());
        let mut other = canonical();
        other.hostname = "other-device.local".to_string();
        registry.upsert(parse_discovery_info(other).unwrap());
        assert_eq!(registry.size(), 2);
    }

    #[test]
    fn removes_and_clears_deterministically() {
        let mut registry = DiscoveryRegistry::new();
        registry.upsert(parse_discovery_info(canonical()).unwrap());
        registry.remove("receiver-device.local", 45821);
        assert_eq!(registry.size(), 0);
        registry.upsert(parse_discovery_info(canonical()).unwrap());
        assert_eq!(registry.size(), 1);
        registry.clear();
        assert_eq!(registry.size(), 0);
        assert!(registry.list().is_empty());
    }
}