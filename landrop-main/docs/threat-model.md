# LanDrop — Threat Model (Phase 09 Security Documentation)

> **Phase 09 documentation.** Contents of this file are maintained with Phases 09 and reflect the delivery-state, integrity, and install-gating guarantees implemented and validated up to that point. It is not a historical requirements document; it records the actual security posture and the residual risks that remain open.

Date: 2026-09-10 · Status: `SECURITY REVIEW COMPLETED + FINDINGS / MITIGATIONS / RESIDUAL RISKS` (report phase-09)

## 1. Assets

| Asset | Owner | Notes |
|---|---|---|
| In-transit APK bytes | Sender / Receiver | Binary plane, declared size §17/§18, SHA-256 binding §20 |
| Staged (verified) APK file | Receiver | `ArtifactStore`; exists only from finish() of a sealed write |
| SHA-256 digest (declared/actual) | Receiver | Validated before any install path may advance (§21 truth table) |
| Delivery machine state | Receiver engine | The 18-state machine is the gating authority |
| Install handoff | Receiver | `INSTALL_READY → INSTALLATION_HANDOFF` may only be reached via a verified artifact |
| Control-plane JSON | Both peers | Bound by `maxJsonBytes` (65536) and depth cap (16) |

## 2. Trust Boundaries

1. **Wire boundary** (relatively untrusted): LAN peer(s) provide discovery, session, and control messages. The peer identity is **not authenticated** (protocol §39 gap; see `# 34 Authentication Limitation` in the architecture doc).
2. **Verification boundary**: trusted write path (receiver process) feeds bytes over TLS/secure channel; the hash verdict is the only input allowed to unlock `VERIFIED`.
3. **Install boundary**: `android.content.pm.PackageInstaller`/InstallReceiver; only `InvokeInstaller` actions, emitted by the machine after `VERIFIED`, may call it (Invariant 9/10).
4. **Human boundary**: install does not happen without explicit user decision (`ACCEPT`) — no silent install (Phase 09 constraint).

## 3. Data Flows (attack surface)

Peer → DiscoveryInfo → session → control frames → codec → delivery engine → (ok) → transfer plane → byte accounting → SHA-256 → verdict → install staging → handoff → PackageInstaller.

Untrusted-input entry points:
- Discovery payloads (`parseDiscoveryInfo`).
- Session establishment payloads (`establishSession`), connection/secure-channel attempts.
- Control frames (length-prefixed, `FrameDecoder`), JSON messages (codec), metadata (`package_name`, `size_bytes`, `sha256`, presentation fields).
- Transfer cancel / decision / response messages (engine ops).

## 4. Threat Model (STRIDE)

| Threat | Addressed by | Residual |
|---|---|---|
| **Spoofing** (falsify peer/message) | Delivery-state gating; session/connection failure outcomes route to FAILED before install trust | No peer authentication; no TLS certificate model (deferred) |
| **Tampering** (mutate APK/JSON) | SHA-256 `hashesMatch` pre-install gate; strict JSON grammar; `package_name` identifier regex; strict UTF-8 frame decode | TOCTOU window between `VERIFIED` and store delete is closed only by ownership discipline, not by OS-level confinement |
| **Repudiation** | `observer(...)`/`recordAction` trace in coordinators | No signed audit log |
| **Information disclosure** | Presentation metadata is user-shared by design; errors return problem codes, not internal state | mDNS broadcasts hostname/port; no device/token auth |
| **Denial of service** | Size caps on frames (65536), JSON bytes, JSON depth (16), identifier lengths; latched fail-closed decoder after `FRAME_TOO_LARGE`/`TRUNCATED` | No timeout/resource-limit policy constants (spec gap); replay/dedupe absent (spec gap) |
| **Elevation** (reach install paths illegally) | Machine PINs (V2/V3): `VERIFYING`/`TRANSFERRING` cannot emit install events; terminal states reject every event; engine ops on rejected apply emit `action=None` (F-01) | Installer itself is not sandbox-isolated beyond Android's PackageInstaller |

## 5. Invariants upheld by Phase 09 work

- **Verification-before-install**: no edge reaches `INSTALL_READY`/`INSTALLATION_HANDOFF` except `VERIFIED` (V3 pin).
- **Total rejection**: a rejected engine apply returns `event=null, to=null, action=None, problem≠null` and leaves state untouched (F-01). No side-effect instruction may leak from a rejected apply.
- **Fail-closed decoder**: after one over-limit frame, the decoder serves errors only; a subsequent valid frame is refused.
- **Malicious-metadata rejection**: `package_name` accepts only `[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+`; traversal/slash/colon/percent-encoded names are rejected. Duplicate JSON keys resolve last-value-wins (kotlinx/`JSON.parse` semantics).
- **Install gating**: `completeVerification` mismatch ⇒ `INTEGRITY_MISMATCH` ⇒ `FAILED`; the installed artifact always equals the verified artifact (Temp-Store ownership, Invariant 9/10).

## 6. Residual Risks (open)

1. **TOCTOU** between `VERIFIED` (hash ok, staged file) and `store.delete()` after handoff completion — mitigated by single-owner single-writer discipline; not OS-confined.
2. **No peer authentication / no TLS PKI model** — protocol §39 and transport §29 deferrals; a network adversary could impersonate within the LAN (out of scope, recorded).
3. **Delivery IDs are soft** — request/transfer/session ids are validated strings, not hard cryptographic tokens.
4. **Resource bounds are hard-coded** (65536 / 16 / identifier lengths) with no configuration knob; derived from the spec, not tunable.
5. **Rust and Kotlin mirrors not executed** — TypeScript suite executed green (382); Rust `delivery.rs` and Kotlin `Delivery.kt` guard parity reviewed by inspection only (no toolchains).

See the Phase 09 report sections Y (residual risk register) and AE (final status) for the numbering and sign-off.