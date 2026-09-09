package com.landrop.receiver.application

import com.landrop.receiver.protocol.SessionId
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardOpenOption

// App-controlled temporary artifact storage (architecture spec §20). The
// artifact lives under <session-id>/application.apk where <session-id> is a
// validated protocol SessionId (strict ASCII grammar with no separators), so
// no network-supplied path can ever be formed. Writes are bounded by the
// declared size; finish() seals only when the written size matches. The
// concrete file store below is plain JVM (java.nio) so unit tests run it
// without a device; the Android app layer selects the filesystem root.
object ArtifactPath {
    const val FILE_NAME = "application.apk"

    fun parentSegment(sessionId: SessionId): String = sessionId.value

    fun relative(sessionId: SessionId): String = "${parentSegment(sessionId)}/$FILE_NAME"
}

interface ArtifactStore {
    val sessionId: SessionId

    /** Prepare the controlled directory and truncate any prior artifact. */
    fun begin(expectedSizeBytes: Long): Result<Unit>

    /** Append bytes; fails once the declared size would be exceeded. */
    fun append(chunk: ByteArray): Result<Unit>

    /** Seal the artifact; succeeds only when written bytes equal the declared size. */
    fun finish(): Result<OwnedArtifact>

    /** Delete the artifact and its controlled directory (lifecycle terminal). */
    fun delete()
}

data class OwnedArtifact(val path: String, val sizeBytes: Long)

class FileArtifactStore(
    override val sessionId: SessionId,
    root: Path,
) : ArtifactStore {
    private val dir: Path = root.resolve(ArtifactPath.parentSegment(sessionId)).normalize()
    private val file: Path = dir.resolve(ArtifactPath.FILE_NAME)
    private var expectedSizeBytes: Long = 0
    private var written: Long = 0

    override fun begin(expectedSizeBytes: Long): Result<Unit> = runCatching {
        require(expectedSizeBytes > 0) { "declared size must be positive" }
        this.expectedSizeBytes = expectedSizeBytes
        written = 0
        Files.createDirectories(dir)
        Files.deleteIfExists(file)
        Files.createFile(file)
    }

    override fun append(chunk: ByteArray): Result<Unit> {
        if (chunk.isEmpty()) return Result.success(Unit)
        return runCatching {
            if (written + chunk.size > expectedSizeBytes) {
                error("artifact exceeds declared size")
            }
            Files.write(file, chunk, StandardOpenOption.APPEND)
            written += chunk.size
        }
    }

    override fun finish(): Result<OwnedArtifact> = runCatching {
        if (written != expectedSizeBytes) {
            error("artifact size mismatch: $written != $expectedSizeBytes")
        }
        OwnedArtifact(ArtifactPath.relative(sessionId), written)
    }

    override fun delete() {
        runCatching { Files.deleteIfExists(file) }
        runCatching { Files.deleteIfExists(dir) }
    }
}