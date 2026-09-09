package com.landrop.receiver.platform

import java.io.InputStream
import java.security.MessageDigest

// Platform SHA-256 digest seal for the receiver (protocol spec §20, project
// spec §14, architecture §19-§20). Streaming over the platform MessageDigest;
// only the 64-character lowercase-hex representation (the repository-wide
// digest format) is ever exposed to the protocol layer. Reads consume the
// full stream, so callers stream the verified artifact once and compare
// against the request's declared digest via Integrity.hashesMatch.
//
// Mirrors sender/desktop/src/application/sha256Hash.ts (Node `crypto`). The
// Rust host seam is deferred: sender-side APK hashing is app-layer work that
// would require the RustCrypto `sha2` crate, which repository policy leaves
// out of Phase 07 (see protocol/integrity.rs).
object Sha256Stream {
    private const val BUFFER_SIZE = 64 * 1024

    fun digestHex(source: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(BUFFER_SIZE)
        while (true) {
            val read = source.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
        return digest.digest().joinToString(separator = "") { byte ->
            (byte.toInt() and 0xff).toString(16).padStart(2, '0')
        }
    }
}