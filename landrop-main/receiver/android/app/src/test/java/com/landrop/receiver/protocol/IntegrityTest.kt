package com.landrop.receiver.protocol

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class IntegrityTest {
    private companion object {
        const val EMPTY =
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        const val ABC =
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        const val HELLO =
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
    }

    @Test
    fun knownVectorsAreValidLowercaseDigests() {
        assertTrue(Integrity.isValidSha256(EMPTY))
        assertTrue(Integrity.isValidSha256(ABC))
        assertTrue(Integrity.isValidSha256(HELLO))
    }

    @Test
    fun rejectsMalformedDigests() {
        assertFalse(Integrity.isValidSha256("abc"))
        assertFalse(Integrity.isValidSha256(""))
        assertFalse(Integrity.isValidSha256("a".repeat(63)))
        assertFalse(Integrity.isValidSha256("a".repeat(65)))
        assertFalse(Integrity.isValidSha256("g".repeat(64)))
    }

    @Test
    fun comparisonIsCaseInsensitiveAndValidated() {
        assertTrue(Integrity.hashesMatch(ABC, ABC))
        assertTrue(Integrity.hashesMatch(ABC.uppercase(), ABC))
        assertTrue(Integrity.hashesMatch(ABC, ABC.uppercase()))
        assertFalse(Integrity.hashesMatch(ABC, EMPTY))
        assertFalse(Integrity.hashesMatch("not-a-digest", ABC))
        assertFalse(Integrity.hashesMatch(ABC, ""))
    }

    @Test
    fun classificationFollowsProtocolTruthTable() {
        assertSame(Integrity.IntegrityVerdict.VERIFIED, Integrity.classifyVerification(ABC, ABC))
        assertSame(
            Integrity.IntegrityVerdict.VERIFIED,
            Integrity.classifyVerification(ABC.uppercase(), ABC),
        )
        assertSame(
            Integrity.IntegrityVerdict.INTEGRITY_MISMATCH,
            Integrity.classifyVerification(ABC, EMPTY),
        )
    }
}