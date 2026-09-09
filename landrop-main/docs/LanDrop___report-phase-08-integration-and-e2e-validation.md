# Phase 08 — Integration & End-to-End Validation — Implementation Report

**Status:** `PHASE 08 COMPLETE — WITH UNEXECUTED E2E AND TOOLCHAIN VERIFICATION`
**Date:** 2026-09-09
**Locale clock:** MSK (UTC+3), matches the protocol-grade timestamps used in fixtures

This report is the Phase 08 deliverable for the strict spec-driven 31-step program. It references the frozen Phase 01–07 baselines and the Prompt-generated Engineering Task List (ETL). Section labels follow the mandated A–X scheme used by every phase.

---

## A. Closed Baseline References (Definition of Done input)

| Item | Reference |
|---|---|
| Protocol spec | `protocol/LanDrop___protocol-protocol-spec.md` (§2 message classes, §5 steps 6–7, §6 v1 gate, §7 session, §17 binary transfer plane, §18 declared size, §20 SHA-256, §21 verification truth table, §23 install, §27 `connection_lost`) |
| Project spec | `LanDrop___PROJECT_SPECIFICATION.md` (§14–§16, §24, §26–§27, §36 network-provided names, §39, §58) |
| Architecture doc | `docs/LanDrop___docs-architecture.md` (§19–§20 install, §27 mDNS, §28 establishment, §32 integrity, §41 platform transport seams deferred) |
| Phase 02 frozen baseline | Codec/ErrorCodes — payload grammar, full ErrorCode/ErrorReason surface |
| Phase 03 frozen baseline | 18-state Delivery State Machine — no Phase 08 modification |
| Phase 04–06 baselines | transport, framing, message-stream, discovery, connection attempt, secure channel, session establishment, engine |
| Phase 07 baselines | integrity (`completeVerification`), install staging (`prepareInstall`/`handoffInstall`/`installationCompleted`/`installationUnavailable`), `invoke_installer` action, SHA-256 seams |
| Recording precedent | `sender/desktop/src/protocol/delivery-flow.test.ts` — the binary-plane framing gap and the "both peers same transfer id" offline-mirror convention |
| Machine sources of truth | `state-machine.ts`, `state_machine.rs`, `DeliveryStateMachine.kt` — none modified in this phase |

No Phase 03+ machine has been changed. Phase 08 adds application-layer seams only; every delivery state transition still flows through the untouched machine operations.

## B. Report Date

All toolchain executions in this report ran on **2026-09-09**. Byte-for-byte hashes in tests are independent of date/locale.

## C. Inputs

1. The Phase 08 action prompt (strict phases, steps, status verbs, final report A–X).
2. `protocol/LanDrop___protocol-protocol-spec.md` §2, §5–§7, §17–§23, §27.
3. `LanDrop___PROJECT_SPECIFICATION.md` §14–§16, §24, §26–§27, §36, §58.
4. `docs/LanDrop___docs-architecture.md` §27–§28, §32, §41.
5. Phase 07 code, fixtures, and the `delivery-flow.test.ts` harness as the unmodifiable base.

## D. Constraints Recorded (held during the phase)

1. **No new Delivery States, events, wire messages, or ErrorCodes.** The machine is coin-operated; Phase 08 consumes exactly the existing ACKNOWLEDGED→WAITING_FOR_DECISION, WAITING_FOR_DECISION→ACCEPTED/REJECTED, ACCEPTED→TRANSFERRING, TRANSFERRING→VERIFYING, VERIFYING→VERIFIED/FAILED, VERIFIED→INSTALL_READY, INSTALL_READY→INSTALLATION_HANDOFF, INSTALLATION_HANDOFF→COMPLETED, CANCELLED, FAILED (connection-loss / cancellation) edges.
2. **Presentation mode stays sender-driven.** The Sender initiates; the Receiver is prompted. The desktop service is the driver; the Android coordinator is the responder.
3. **Recorded spec gaps are documented, not fixed.** (a) `transfer_id` has no wire carrier (protocol §17–§19) — the Receiver cannot learn the Sender's id, so it assigns a local `TransferId`; an inbound Sender `transfer_cancel` cannot correlate and the engine truthfully answers `TRANSFER_ID_MISMATCH`. (b) The binary APK plane has no framing markers — a `transfer_cancel` frame arriving mid-artifact-stream is undecodable (the same gap `delivery-flow.test.ts` records); verification/installation results have no wire feedback message. Nothing invented to close these.
4. **Honest per-side terminal expectations.** Because mid-binary cancel demux is impossible, fixture expectations are expressed per side (`sender_final_state`/`receiver_final_state`). The Sender reaches CANCELLED locally; the Receiver's host reports the aborted stream and reaches FAILED. This is the truthful behavior of the frozen protocol, not a gloss.
5. **No real network.** arch §41 defers the platform transport seams (mDNS/NSD, TCP, TLS 1.3) to their owning phases. Phase 08 uses the existing in-memory duplex; real E2E is impossible by design and by environment.
6. **Mirror integrity of platform hashing.** SHA-256 is computed by Node `crypto` / JVM `MessageDigest` only; tests recompute the digest over received bytes and never trust the fixture hash.
7. **Renderer isolation.** `sha256Hash` (Node-only) is imported by the integration test file (node context) and never by renderer code; verified by clean `vite build` (bundle stays Node-free).
8. **Fixture consumers are presence-only.** `protocol.test.ts` asserts top-level keys via `toHaveProperty` (lines 1064–1076); the additive `integration` block cannot break them.

## E. Theory of Operation

Phase 08 is the missing connection between the frozen protocol layer and the two hosts. Two application-layer seams bookend the same over-the-wire harness used in Phase 06:

```
Sender (desktop service)                          wire (in-memory duplex)        Receiver (Android coordinator)
discovery feed -> registry                      
connect(): ConnectionAttempt -> SecureChannel    <-control frames (JSON)-->      JsonMessageStream feed
  -> establishSession -> DeliveryEngine          <- binary plane (APK bytes) ->> binary-mode switch after ACCEPT
sendDeliveryRequest -> WAITING_FOR_DECISION      <- delivery_response ->>        userDecision -> sendDecision
runTransfer (byte counts vs declared size)       <- artifact stream ->>          store.appendChunk (declared-size bound)
mirrorInstallProgress (same digest + ops)        <- complete -> no feedback ->>  store.finish -> sha256 -> completeVerification
cancel/handleConnectionLoss                      (recorded gaps) ->              cancelLocal / onConnectionLost / onExpiry
```

Both peers drive the identical ordered sequence of frozen engine operations as `delivery-flow.test.ts`: request → await decision → ACCEPT → begin transfer → append chunks → complete transfer → verify → handoff install → completed (or the humanity of each abort path). The Sender-side seam is `LanDropDesktopService`; the Receiver-side seam is `ReceiverCoordinator`; the executable proof is the new vitest suite, which runs both hosts against a shared duplex, recomputes digests, and asserts per-side final states against the fixture.

## F. Completed Work

### TypeScript (executed, green)
- `sender/desktop/src/application/lanDropDesktop.ts` (new, 273 lines) — `LanDropDesktopService(transport, handlers { onStatus, onProgress, onInstallerInvocation, onCleanup })`:
  - Discovery: `feedDiscoveryRecord` (strict `parseDiscoveryInfo`), `removeDevice`, `discoveredDevices` (endpoint-deduplicated).
  - `connect(outcome, secureOutcome, draft)` — single-shot (`idle` → `established`/`failed`), drives `ConnectionAttempt`, `SecureChannelAttempt`, `establishSession` against the real phase-04/05 modules.
  - `sendDeliveryRequest`, `onInbound` (delivery_response routing), `runTransfer(transferId, bytes)` with declared-size enforcement (returns `false` when total ≠ `declaredSize`), `cancelTransfer`, `handleConnectionLoss` (spec §27), `mirrorInstallProgress(actualDigest, installerCompleted)` with the PHASE 07 `INTEGRITY_MISMATCH` check against `completeVerification`, `sessionState` getter. Every engine result is a genuine `DeliveryOutcome`; no direct state writes.
- `sender/desktop/src/application/lanDropDesktop.test.ts` (new, 465 lines) — `ReceiverHarnessPeer` double (own frozen `DeliveryEngine`, control pumping, consent writer, `readAndVerify` with byte accounting and fresh SHA-256, mirror install), `bootSender`/`bootFullStack`, 9 executed tests (see N and S).
- `sender/desktop/src/application/lanDropDesktop.test.ts` + `lanDropDesktop.ts` — `tsc --noEmit` **clean**, `vite build` **green** (32 modules, no Node builtins).

### Fixture (executed)
- `protocol/fixtures/model-cases.json` — additive top-level `integration` block: 5 scenarios (`full_lifecycle_success`, `integrity_mismatch_on_wire`, `rejected_request`, `sender_cancelled_mid_transfer`, `connection_lost_mid_transfer`) with `decision`, `artifact.contents`/`chunk_sizes` (chunk sums equal string byte lengths), declared SHA-256 digests, wire-tamper/cancel/loss offsets, and per-side expectations. All 5 fixture consumers pass (`toHaveProperty` presence-only assertion verified).

### Kotlin (written, NOT executed)
- `receiver/android/app/src/main/java/com/landrop/receiver/application/ReceiverCoordinator.kt` (new, 283 lines) — `(sessionId, store, hashArtifact, installer, localTransferIdFactory)`; `engine`, `outboundFrames`, `awaitingConsent`, `observer`. Feeds transport bytes into `JsonMessageStream` vs the binary plane (binary mode starts exactly at ACCEPT), routes to the frozen `DeliveryEngine`, enforces declared size (protocol §18), computes SHA-256 via the platform seam (§20), verifies (§21), hands verified artifacts to `DeliveryInstaller` (§23), handles `cancelLocal`/`onConnectionLost`/`onExpiry`. No `android.*` imports; JVM-only; no state writes outside the engine.
- `receiver/android/app/src/test/java/com/landrop/receiver/application/ReceiverCoordinatorTest.kt` (new, 203 lines) — 7 JUnit 4 tests with `InMemoryArtifactStore`, `RecordingInstaller`, `sha256Hex`, `encodeJsonFrame` (see N).

## G. Environment

- Node v24.18.1, npm, vitest (16 files), Vite 6.1.0, TypeScript via `tsc --noEmit`; `@types/node` present.
- Re-inventoried this phase: `java`, `javac`, `gradle`, `kotlinc`, `rustc`, `cargo`, `adb`, `sdkmanager`, `emulator` all **MISSING** from PATH; `JAVA_HOME`/`ANDROID_HOME`/`ANDROID_SDK_ROOT` empty. Rust was untouched this phase (no Rust work scheduled); every Kotlin/Android result is marked `IMPLEMENTED — NOT EXECUTED`.
- PowerShell blocks `npm.ps1`/`npx.ps1` (execution policy); all executions used direct `node node_modules/...` invocations. No impact on results.

## H. Work-in-Progress

None — all Phase 08 units are written. Only EXECUTION of the Kotlin mirror suite remains (blocked, infra).

## I. Not Started (by design)

- Real network: mDNS/NSD discovery, TCP socket, TLS 1.3 — arch §41 defers platform transport seams to their owning phases.
- Device E2E: Android emulator/device with the coordinator wired to `PackageInstaller`; UI surfaces.
- Rust: no Phase 08 Rust delta scheduled; parity stays TS/Kotlin until the rust host seam lands.

## J. Blockers

1. No Kotlin/Android toolchain → `gradlew test` for `ReceiverCoordinatorTest.kt` unrun (static review performed; every API referenced verified against the Phase 02–07 Kotlin sources).
2. No device/serial → receiver install E2E unavailable.
3. Real-network E2E is arch-deferred (see I.1), not merely blocked.

These are environment/design limitations, not code defects; the status line records them explicitly.

## K. Verification Plan (executed or recorded)

1. TypeScript gate (EXECUTED): `node node_modules/typescript/bin/tsc --noEmit` **clean**; `node node_modules/vitest/vitest.mjs run` **350/350 passed** across 16 files (341 prior + 9 new); `node node_modules/vite/bin/vite.js build` green (32-module bundle, Node-free).
2. Fresh-digest gate (EXECUTED): `node -c  require('crypto')` recompute of the 4 fixture declared SHA-256 values over the modeled artifact bytes; the suite also recomputes digests over received bytes in `readAndVerify`.
3. Kotlin mirror (RECORDED, blocked): 7 JUnit tests mirroring the TS suite (full lifecycle, tampered artifact, REJECTED, connection loss, local cancel, install unavailable, awaiting-consent) — unexecuted only because no JVM.
4. Audits (EXECUTED, section O/Q).

## L. Critical Decisions

1. **Per-side terminal expectations in fixtures.** Mid-binary cancel demux is impossible (no framing markers). Expecting both peers to agree on `CANCELLED` would force an invented framing invention; instead the fixture — and the test — assert the honest truth: Sender `CANCELLED`, Receiver `FAILED` after host-reported abort. All other scenarios expect symmetric finals.
2. **Cancel scenario models the host abort, not a fabricated demux.** The test stops the Sender transport and drives `connectionLost()` on the Receiver engine — the host report path a real app would use — and asserts `transfer_cancelled` is NOT observed (proving demux was not faked). The concrete evidence is in the test: the Receiver's inbound holds 6 artifact bytes + the 57-byte undecodable cancel frame = 63 raw bytes vs 11 declared.
3. **Local transfer-id factory.** `transfer_id` has no wire carrier, so the Receiver assigns `TransferId("transfer_local_$n")` when bytes first arrive (begin-transfer edge). An inbound Sender cancel therefore hits the honest `TRANSFER_ID_MISMATCH` path documented in the coordinator.
4. **Sender mirror = same ops, no wire feedback.** Verification/install results have no feedback message; the Sender's `mirrorInstallProgress` reaches the same terminal via the identical ordered ops the Receiver used. Parity over the shared harness, not over a nonexistent wire message.
5. **Strict discovery feeds.** `parseDiscoveryInfo` requires `service` (`_lanDrop._tcp.local`) and `protocol_version`; the service does not weaken parsing — tests feed complete records (found by execution, see U.2).
6. **`secureChannel.complete` success signal is an event.** Unlike `ConnectionAttempt.complete` (null on success), `SecureChannelAttempt.complete("established")` returns `"secure_channel_established"`. The service compares against `SECURE_CHANNEL_ESTABLISHED_EVENT` rather than null (found by execution, see U.1).

## M. Verification Implementation Tour

- `connect()`: transport open → `connectionOutcome` through `ConnectionAttempt` → `secureOutcome` through `SecureChannelAttempt` (event-return gotcha above) → `establishSession(draft, prerequisites)` (its own version + validation gates) → engine created on `establishResult.session.session` — the triple `.session` chain is real API, not a test shortcut.
- `runTransfer`: consumes the iterable, feeds each chunk to `engine.engineChunk(bytes)` until `declaredSize`; a short feed stops and returns `false` (partial/cancel/loss scenarios). All feedback is `DeliveryOutcome`.
- `readAndVerify` (harness): reads until `declaredSize`; missing-`end` → `null` (connection-loss path); sums bytes, recomputes SHA-256 over received bytes with `sha256Hex`, verifies via `completeVerification`, drives `prepareInstall` → `handoffInstall` → `installationCompleted` (or `installationUnavailable`), asserting install trace + `invoke_installer` seams on the Sender mirror.
- `ReceiverCoordinator.onBytes`: control plane → `JsonMessageStream`; binary plane once `userDecision(ACCEPT)` → declared-size count; completion → `store.finish` → `hashArtifact` → `completeTransfer` → `completeVerification` → `prepareInstall`/`handoffInstall` → `installer.install` → `InstallOutcome.Succeeded|Unavailable` → `installationCompleted`/`installationUnavailable` → cleanup + `store.delete`. Same op order as `delivery-flow.test.ts` and the TS service.
- Fixture digests: `LanDrop-phase-08` = `c55f71ee…e133`, `Mismatch-on-the-wire` = `23c10c…baea`, `cancel-flow` = `4e6831…9f15`, `loss-after` = `0b0d13…66e4`; tests recompute and never trust them.

## N. Verification Step-Behavior Probes (evidence)

TypeScript evidence (9 executed tests):
1. **Full lifecycle success** — complete journey through discovery → connect → TLS → session → request → ACCEPT → binary (3 chunks, 16 bytes) → verification → install handoff → COMPLETED on both peers; `installer_invoked` on the mirror; install trace on the harness.
2. **Integrity mismatch on the wire** — byte 6 corrupted → computed digest ≠ declared → `integrity_mismatch_install_blocked`, FAILED on both peers, installer never invoked, `storage.delete` cleanup asserted.
3. **Rejected request** — REJECT → both REJECTED, no transfer, statuses contain `rejected`, installer untouched.
4. **Sender cancellation mid-transfer** — partial feed returns `false`, `cancelTransfer` yields a `cleanup` action, Sender `CANCELLED` (status `cancelled`); Receiver hosts the abort (see L.2), `transfer_cancelled` NOT observed, zero installs.
5. **Connection loss mid-transfer (spec §27)** — partial + transport close → Receiver FAILED, `handleConnectionLoss` → Sender FAILED, zero installs.
6. **Duplicate install handoff rejected** — second `mirrorInstallProgress` after completion → `INVALID_STATE`, no double install (install count stays 1).
7. **connect() single-shot; refused transport** — a second `connect()` is refused; a refused outcome → `connection_lost`, link `failed`.
8. **Discovery deduplication** — same endpoint fed twice → one registry entry; full record shape required.
9. **Declared digests match a fresh SHA-256** — fixture hash vs `crypto` recompute over modeled contents (the only test that runs without network).

Kotlin probes (7 mirror tests, RECORDED/blocked): awaiting-consent (WAITING_FOR_DECISION, no fabricate before consent), full lifecycle (COMPLETED + install + cleanup), tampered artifact (mismatch → FAILED, no install), rejected request (REJECTED), connection loss (FAILED), local cancel (CANCELLED via host), install unavailable (FAILED + cleanup). Static review confirms they exercise real symbols only (`Sha256`, `encodeJsonFrame`, `DeliveryOutcome`, `InstallOutcome`, `ArtifactStore`/`OwnedArtifact` — all inventoried bases).

## O. Peripheral Integration

- Renderer (`App.tsx`/`App.test.tsx`) untouched; `sha256Hex` never reaches the bundle (clean vite build).
- `AndroidManifest.xml` untouched: **INTERNET remains the only permission**; the coordinator/installer introduce no su/root/`Runtime.exec`/`ProcessBuilder`/`PackageInstaller` misuses — `DeliveryInstaller` stays an interface; installs are never fabricated.
- Direct state-mutation audit: grep for `.state =` and raw `transition("…")` in both Phase 08 seams → **zero matches**; all state changes flow through frozen engine ops.
- No machine, codec, message-stream, discovery, or phase 02–07 file modified this phase. Only 4 new source files + 1 additive fixture block.
- Future-phase contamination audit: new files import only existing `../protocol/*` modules and Node `crypto`; no renderer/platform/future-phase imports.

## P. Error Handling

- REJECTED routes both peers to REJECTED; `sendDecision` outside WAITING_FOR_DECISION is rejected (`INVALID_STATE`).
- Integrity mismatch is return-`ok` (machine ran), semantically negative, `INTEGRITY_MISMATCH`, cleanup emitted, no install path.
- Duplicate/mid-flight `mirrorInstallProgress`, `runTransfer` with wrong declared size, and second `connect()` are all rejected with real machine semantics (`INVALID_STATE`, `false`, link stays `failed`).
- `handleConnectionLoss`/`onConnectionLost`/`onExpiry` map to FAILED only from pre-terminal states; terminal engines refuse further ops.
- Refused transport: `connection_lost` → `failed`, never a phantom session.

## Q. Code-Review Notes

- TS imports from `.test.ts` types keep `type` qualifiers (`TransferCancel`, `DeliveryState`, etc. remain type-only; no runtime import of the protocol module that could leak state).
- The `ConnectionAttempt.complete` (null = success) vs `SecureChannelAttempt.complete` (event = success) asymmetry is documented in both the service and this report — easy parity-maintenance trap.
- `noUncheckedIndexedAccess` handled with the `IntegrationScenario` interface + non-null guards (`scenarios[3]!`, `copy[at] ?? 0`); `sha256Hex` import is node-context only.
- Kotlin coordinator keeps one op order identical to `delivery-flow.test.ts`; only the local transfer-id factory differs (by design, recorded in the file header).
- Test harness double uses its own real `DeliveryEngine` — no stubs that fake machine behavior; `readAndVerify` recomputes digests, and assertions target per-side finals from the fixture.

## R. Production-Readiness Notes

- The seams are thin and removable: swapping the in-memory duplex for real sockets later only re-plugs `Transport`; neither seam knows about the test harness.
- Declared-size enforcement bounds binary ingestion before verification; `FileArtifactStore` (Phase 07) bounds writes and validates on seal.
- Installers are never fabricated; the app layer owns the sole concrete `DeliveryInstaller`.
- Deterministic, offline, fixture-backed tests; hashes recomputed at runtime.

## S. Test Summary

| Suite | Before | Added | Total | Status |
|---|---|---|---|---|
| vitest (16 files) | 341 | 9 | 350 | ✅ 350/350 under `node node_modules/vitest/vitest.mjs run`; `tsc --noEmit` clean; `vite build` green |
| Kotlin `ReceiverCoordinatorTest` | 0 | 7 | 7 | ⛔ written only (no gradle/JVM) |
| Fixture `integration` block | 0 | 5 scenarios | 5 | ✅ consumed by executable TS suite (all 5 run) |
| Rust | n/a | 0 | 0 | 🔒 untouched this phase (no scheduled delta) |

## T. Variance From Prompts

No scope, machine, or wire change. The single behavioral deviation is forced by the recorded spec gap and is **documented, not glossed**: the `sender_cancelled_mid_transfer` fixture expects per-side finals (`sender CANCELLED` / `receiver FAILED`) instead of a symmetric state, because the frozen binary plane cannot demux a cancel frame. The alternative would have required inventing framing — explicitly forbidden.

## U. Findings & Fixes

1. **`SecureChannelAttempt.complete` returns an event on success** (connection attempt returns `null`), so the service's first draft treated a successful TLS outcome as failure → `connect()` returned `false`. Fixed by comparing against the exported `SECURE_CHANNEL_ESTABLISHED_EVENT`. Caught by executing the tests (this plus the discovery fix took the suite from 8/9 red to 2/9 red; the remaining two fell to the next two findings).
2. **`parseDiscoveryInfo` is strict**: discovery feeds without `service`/`protocol_version` (allowed by the loose input union but rejected by validation) returned `false`. Tests were corrected to feed full records. Caught by execution.
3. **Two cancel/loss scenarios lacked `declared_sha256`** → the codec's request validation rejected the frame, the Receiver never reached WAITING_FOR_DECISION (consent red). Fixed in the fixture (`4e6831…` / `0b0d13…`). 
4. **Demux-impossibility surfaced as a hard number**: `readAndVerify`'s byte accounting saw 63 raw bytes (6 artifact + 57-byte cancel frame) vs 11 declared, throwing before the honest abort path. The cancel test now models the host-abort report (L.2) instead of strict byte accounting, and the evidence is asserted (`transfer_cancelled` not observed).

## V. Risks / Limitations (Resolved, Open)

- **Resolved:** connect()-false bug (secure channel event gotcha); strict discovery record shape; missing declared digests; cancel-scenario accounting. All resolved by execution, each with a documented root cause.
- **Open (explicitly deferred):** Kotlin mirror execution (no JVM); real mDNS/TCP/TLS (arch §41); device E2E with concrete `PackageInstaller`; any future spec decision on framing markers or a `transfer_id` wire carrier; wire feedback for verification/install results.

## W. Definition of Done

Per-phase step list:
- [x] Step 1 — Baseline closure & prompt obligations audit.
- [x] Step 2 — Inspection of all affected modules/fixtures/toolchains.
- [x] Step 3 — Integration matrix: which seams meet, where, and under which frozen ops.
- [x] Step 4 — Spec-gap inventory (transfer_id carrier, binary framing, result feedback) recorded, not worked around.
- [x] Step 5 — Fixture `integration` block authored (5 scenarios, per-side expectations, fresh digests).
- [x] Step 6 — Sender/desktop application-layer service seam authored.
- [x] Step 7 — Sender integration tests executed green (9/9), collapsed into full regression.
- [x] Step 8 — Receiver Android coordinator seam + mirror JUnit suite authored (execution blocked, recorded).
- [x] Step 9 — Post-integration audits: no direct machine mutation, no invented messages, INTERNET-only permission, renderer/contamination clean, TS↔Kotlin parity, strict-fingerprint fixtures — all pass.
- [x] Step 10 — Full regression: `tsc` clean, **350/350**, build green.
- [x] Step 11 — Final report A–X + DoD + status verb (this document).

Phase-08 DoD checklist:
- [x] Sender and Receiver reach identical finals for ACCEPT success, mismatch, REJECT, and connection loss (per-side honest finals for Sender cancel — documented gap).
- [x] No new states/events/wire fields/ErrorCodes; presentations stay sender-driven.
- [x] Every transition flows through the frozen machine ops; purge audit clean.
- [x] Fixtures additive and presence-safe; digests fresh-computed at runtime.
- [x] 350/350 TS green; Kotlin parity complete with explicit unexecuted-status flag; real E2E transparently recorded as NOT EXECUTED.

## X. Recommended Follow-Ups

1. Run `./gradlew test` when a JVM/AOSP toolchain appears (expect green; the suite uses only inventoried APIs).
2. Next phase: wire `ReceiverCoordinator` to real NSD/mDNS + TCP + TLS and the concrete `PackageInstaller`; connect the desktop service to the platform mDNS/TCP seam — the Transport seam is the only swap needed.
3. Explicit spec decision (not engineering invention) on: frame markers for the binary plane, a `transfer_id` carrier, and a verification/install-result feedback message — until then the honest gap behavior stands.
4. Device E2E on a real receiver; then any UI result surface.

---

*End Phase 08 report.*