package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DiscoveryTest {

    private fun canonical() = RawDiscoveryInfo(
        service = DISCOVERY_SERVICE_TYPE,
        hostname = "receiver-device.local",
        port = 45821,
        protocolVersion = 1,
        deviceName = "Android Device",
        extraTxtKeys = listOf("lanDrop_version=0.1.0", "capability=apk_delivery"),
    )

    @Test
    fun serviceTypeMatchesSpecification() {
        assertEquals("_lanDrop._tcp.local", DISCOVERY_SERVICE_TYPE)
    }

    @Test
    fun parsesCanonicalDiscoveryInformation() {
        val info = (parseDiscoveryInfo(canonical()) as DiscoveryParseResult.Ok).info
        assertEquals("_lanDrop._tcp.local", info.service)
        assertEquals("receiver-device.local", info.hostname)
        assertEquals(45821, info.port)
        assertEquals(1, info.protocolVersion)
        assertEquals("Android Device", info.deviceName)
        assertTrue(isDiscoverySupportedVersion(info))
    }

    @Test
    fun trimsTheDeviceDisplayName() {
        val info = (parseDiscoveryInfo(canonical().copy(deviceName = "  Android Device  ")) as DiscoveryParseResult.Ok).info
        assertEquals("Android Device", info.deviceName)
    }

    @Test
    fun ignoresUnknownExtraTxtKeys() {
        val info = (parseDiscoveryInfo(canonical()) as DiscoveryParseResult.Ok).info
        assertEquals("Android Device", info.deviceName)
        assertEquals(45821, info.port)
    }

    @Test
    fun rejectsEveryMalformedCase() {
        val cases = listOf(
            canonical().copy(service = "_other._tcp.local") to DiscoveryProblem.INVALID_SERVICE,
            canonical().copy(hostname = "") to DiscoveryProblem.INVALID_HOSTNAME,
            canonical().copy(hostname = "has space.local") to DiscoveryProblem.INVALID_HOSTNAME,
            canonical().copy(hostname = "a/b") to DiscoveryProblem.INVALID_HOSTNAME,
            canonical().copy(hostname = "a\\b") to DiscoveryProblem.INVALID_HOSTNAME,
            canonical().copy(port = 0) to DiscoveryProblem.INVALID_PORT,
            canonical().copy(port = 65536) to DiscoveryProblem.INVALID_PORT,
            canonical().copy(protocolVersion = 1_500_000_000_000) to DiscoveryProblem.INVALID_PROTOCOL_VERSION,
            canonical().copy(deviceName = "   ") to DiscoveryProblem.INVALID_DEVICE_NAME,
        )
        for ((raw, problem) in cases) {
            assertEquals(problem, (parseDiscoveryInfo(raw) as DiscoveryParseResult.Failing).problem)
        }
    }

    @Test
    fun acceptsUnsupportedVersionAsValidMetadataButFlagsIt() {
        for (version in listOf(-1L, 0L, 2L)) {
            val info = (parseDiscoveryInfo(canonical().copy(protocolVersion = version)) as DiscoveryParseResult.Ok).info
            assertFalse(isDiscoverySupportedVersion(info))
        }
    }

    @Test
    fun registryCollapsesDuplicateAdvertisements() {
        val registry = DiscoveryRegistry()
        val info = (parseDiscoveryInfo(canonical()) as DiscoveryParseResult.Ok).info
        registry.upsert(info)
        registry.upsert(info)
        assertEquals(1, registry.size)
        assertEquals("Android Device", registry.list().first().deviceName)
    }

    @Test
    fun identifiesPeersByHostnamePort() {
        assertEquals("receiver-device.local:45821", deviceIdentity("receiver-device.local", 45821))
        val registry = DiscoveryRegistry()
        registry.upsert((parseDiscoveryInfo(canonical()) as DiscoveryParseResult.Ok).info)
        registry.upsert((parseDiscoveryInfo(canonical().copy(hostname = "other-device.local")) as DiscoveryParseResult.Ok).info)
        assertEquals(2, registry.size)
    }

    @Test
    fun removesAndClearsDeterministically() {
        val registry = DiscoveryRegistry()
        registry.upsert((parseDiscoveryInfo(canonical()) as DiscoveryParseResult.Ok).info)
        registry.remove("receiver-device.local", 45821)
        assertEquals(0, registry.size)
        registry.upsert((parseDiscoveryInfo(canonical()) as DiscoveryParseResult.Ok).info)
        assertEquals(1, registry.size)
        registry.clear()
        assertTrue(registry.list().isEmpty())
    }
}