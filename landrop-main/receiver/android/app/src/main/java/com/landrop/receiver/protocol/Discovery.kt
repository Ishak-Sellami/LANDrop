package com.landrop.receiver.protocol

// Discovery foundation (protocol spec §4, project spec §16, architecture §27).
// Deterministic parsing/validation of mDNS/DNS-SD service information plus a
// device registry. The platform seam (NSD/services on Android) feeds raw
// records here; this module never performs I/O.
// Discovery is informational only and does not authenticate a device.

// Fixed service type for LanDrop v1 (protocol spec §4).
const val DISCOVERY_SERVICE_TYPE = "_lanDrop._tcp.local"

// Local problem tags for malformed discovery metadata. These are NOT wire
// ErrorCodes; the peer is simply excluded from the device list.
enum class DiscoveryProblem {
    INVALID_SERVICE,
    INVALID_HOSTNAME,
    INVALID_PORT,
    INVALID_PROTOCOL_VERSION,
    INVALID_DEVICE_NAME,
}

data class DiscoveryInfo(
    val service: String,
    val hostname: String,
    val port: Int,
    val protocolVersion: Int,
    val deviceName: String,
)

// Raw record materialized by the local discovery seam into typed fields.
// Unknown extra TXT keys are carried but ignored (forward-compatible;
// project §16 lists optional metadata we do not model).
data class RawDiscoveryInfo(
    val service: String,
    val hostname: String,
    val port: Long,
    val protocolVersion: Long,
    val deviceName: String,
    val extraTxtKeys: List<String> = emptyList(),
)

sealed class DiscoveryParseResult {
    data class Ok(val info: DiscoveryInfo) : DiscoveryParseResult()
    data class Failing(val problem: DiscoveryProblem) : DiscoveryParseResult()
}

// Hostnames travel the local network untouched; reject anything that could be
// used to smuggle a path (project spec §36: network-provided names must never
// be concatenated into paths).
private fun isValidHostname(hostname: String): Boolean =
    hostname.isNotEmpty() && hostname.none { it.isWhitespace() || it == '/' || it == '\\' }

fun parseDiscoveryInfo(raw: RawDiscoveryInfo): DiscoveryParseResult {
    // Unknown extra TXT keys are ignored.
    if (raw.service != DISCOVERY_SERVICE_TYPE) {
        return DiscoveryParseResult.Failing(DiscoveryProblem.INVALID_SERVICE)
    }
    if (!isValidHostname(raw.hostname)) {
        return DiscoveryParseResult.Failing(DiscoveryProblem.INVALID_HOSTNAME)
    }
    if (raw.port < 1 || raw.port > 65535) {
        return DiscoveryParseResult.Failing(DiscoveryProblem.INVALID_PORT)
    }
    if (raw.protocolVersion !in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
        return DiscoveryParseResult.Failing(DiscoveryProblem.INVALID_PROTOCOL_VERSION)
    }
    val deviceName = raw.deviceName.trim()
    if (deviceName.isEmpty()) {
        return DiscoveryParseResult.Failing(DiscoveryProblem.INVALID_DEVICE_NAME)
    }
    return DiscoveryParseResult.Ok(
        DiscoveryInfo(
            service = raw.service,
            hostname = raw.hostname,
            port = raw.port.toInt(),
            protocolVersion = raw.protocolVersion.toInt(),
            deviceName = deviceName,
        ),
    )
}

fun isDiscoverySupportedVersion(info: DiscoveryInfo): Boolean =
    info.protocolVersion == CURRENT_PROTOCOL_VERSION

// A discovered peer is identified by its resolved host and port. No separate
// device identifier is defined by the protocol; session/request IDs remain
// the only protocol-level identifiers.
fun deviceIdentity(hostname: String, port: Int): String = "$hostname:$port"

data class DiscoveredDevice(
    val identity: String,
    val hostname: String,
    val port: Int,
    val protocolVersion: Int,
    val deviceName: String,
    val supported: Boolean,
)

// Deterministic in-memory device list. Duplicate advertisements collapse to a
// single logical entry (identity = hostname:port). No TTL is invented: peers
// leave the list only through an explicit disappearance signal (removal) or
// shutdown (clear).
class DiscoveryRegistry {
    private val entries = mutableMapOf<String, DiscoveredDevice>()

    val size: Int
        get() = entries.size

    fun upsert(info: DiscoveryInfo) {
        val device = DiscoveredDevice(
            identity = deviceIdentity(info.hostname, info.port),
            hostname = info.hostname,
            port = info.port,
            protocolVersion = info.protocolVersion,
            deviceName = info.deviceName,
            supported = isDiscoverySupportedVersion(info),
        )
        entries[device.identity] = device
    }

    fun remove(hostname: String, port: Int) {
        entries.remove(deviceIdentity(hostname, port))
    }

    fun clear() {
        entries.clear()
    }

    fun list(): List<DiscoveredDevice> = entries.values.toList()
}