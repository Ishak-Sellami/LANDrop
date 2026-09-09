package com.landrop.receiver.application

// Smallest platform installer seam (project spec §26, architecture §20). The
// pure Delivery Engine only emits the HANDOFF_INITIATED / InvokeInstaller
// instruction; the application layer invokes Android's supported package-
// installation mechanism here and reports the outcome back. No root, no shell,
// no silent install; user consent is preserved by the platform installer. The
// concrete Android (PackageInstaller) wiring lands with the app layer / device
// tooling, so this seam keeps the boundary explicit and testable in isolation.
interface DeliveryInstaller {
    /** Returns the real platform outcome; nothing is fabricated. */
    fun install(artifact: OwnedArtifact): InstallOutcome
}

sealed interface InstallOutcome {
    /** Package install genuinely completed on the platform. */
    data object Succeeded : InstallOutcome

    /** The platform installer is unavailable (INSTALLATION_UNAVAILABLE). */
    data object Unavailable : InstallOutcome
}