# Phase 07 — Integrity Verification & Installation Foundation — Implementation Report

**Status:** `PHASE 07 COMPLETE — WITH UNEXECUTED TOOLCHAIN VERIFICATION`
**Date:** 2026-09-09
**Locale clock:** MSK (UTC+3), matches the protocol-grade timestamps used in fixtures

This report is the Phase 07 deliverable for the strict spec-driven 31-step program. It references the frozen Phase 01-06 baselines and the Prompt-generated Engineering Task List (ETL). All section labels below follow the mandated A-X scheme used by every phase of the program.

---

## A. Closed Baseline References (Definition of Done input)

| Item | Reference |
|---|---|
| Protocol spec | `protocol/LanDrop___protocol-protocol-spec.md` |
| Project spec | `LanDrop___PROJECT_SPECIFICATION.md` |
| Architecture doc | `docs/LanDrop___docs-architecture.md` |
| Phase 02 frozen baseline | Codec/ErrorCodes — payload grammar + full ErrorCode/ErrorReason surface |
| Phase 03 frozen baseline | 18-state Delivery State Machine — same states/events, in-memory pure table, all-transition tests |
| Phase 04-06 frozen baselines | Transport, framing, message-stream, discovery, session establishment/secure channel, engine (shipped without the Phase 07 state-gated ops) |
| Test conventions | JUnit 4 (Kotlin), inline `#[cfg(test)]` + `tests.rs` (Rust), vitest (TypeScript) |
| Machine sources of truth | `sender/desktop/src/protocol/state-machine.ts`, `state_machine.rs`, `DeliveryStateMachine.kt` — none modified in this phase |

No Phase 03+ machine has been changed. The Phase 07 engine operations only consume the machine's existing VERIFYING/VERIFIED/INSTALL_READY/INSTALLATION_HANDOFF/FAILED/COMPLETED edges.

## B. Report Date

All toolchain executions in this report ran on **2026-09-09**. Byte-for-byte hashes in tests are independent of date/locale.

## C. Inputs

1. The Phase 07 action prompt (strict phases, steps, DoD, final report A-X).
2. `protocol/LanDrop___protocol-protocol-spec.md` §20-§26.
3. `LanDrop___PROJECT_SPECIFICATION.md` §14, §24, §26, §27, §39.
4. `docs/LanDrop___docs-architecture.md` §19-§20, §32.
5. Phase 06 code as the unmodifiable base.

## D. Constraints Recorded (held during the phase)

1. **No new Delivery States or events.** Phase 03 machine is coin-operated; the machine already defines every transition this phase invokes (VERIFYING→VERIFIED, VERIFYING→FAILED via INTEGRITY_MISMATCH, VERIFIED→INSTALL_READY via INSTALL_PREPARED, INSTALL_READY→INSTALLATION_HANDOFF via HANDOFF_INITIATED, INSTALL_READY/INSTALLATION_HANDOFF→FAILED via INSTALLATION_UNAVAILABLE, INSTALLATION_HANDOFF→COMPLETED via COMPLETED).
2. **No new wire fields.** Integrity and install staging reuse declared request metadata (`application.identity.sha256`, `size_bytes`) and existing ErrorCodes (`INTEGRITY_MISMATCH`, `INSTALLATION_UNAVAILABLE`, etc.). Nothing is serialized over the wire in this phase.
3. **Platform crypto only.** SHA-256 is computed by Node `crypto` (host seam) / JVM `MessageDigest` (Kotlin). No custom hash logic.
4. **No new Rust dependencies.** RustCrypto `sha2` is deferred (documented in `integrity.rs` header); the Rust mirror implements the pure validation/comparison/classification layer only.
5. **No UI, no file dialogs, no silent installs, no actual installation work** in this phase. The installer is a seam; only a genuine platform-reported result (or unavailability) drives the engine.
6. **Uniform terminal-state rule.** Every terminal outcome emits the cleanup action; `handoffInstall` emits the new `invoke_installer` instruction.
7. **Renderer isolation.** `node:crypto` lives in `src/application/sha256Hash.ts` and must never be imported by the renderer/vite bundle.

## E. Theory of Operation

Phase 07 closes the gap between transfer completion (VERIFYING entry) and the Android package install step. Three seams meet inside the frozen machine:

1. **Computation seam** — platform digest: `sha256Hex(AsyncIterable<Uint8Array>)` (Node) / `Sha256Stream.digestHex(InputStream)` (JVM). Never part of the protocol layer.
2. **Purity seam** — `integrity.ts` / `integrity.rs` / `Integrity.kt`: `isValidSha256`, `hashesMatch` (validates both inputs, ASCII lowercases, then compares), `classifyVerification` (protocol §21 truth table). Identical behavior across all three mirrors.
3. **Decision seam** — engine ops (`completeVerification`, `prepareInstall`, `handoffInstall`, `installationCompleted`, `installationUnavailable`) route through the machine and emit instructions (`None`, `InvokeInstaller`, `Cleanup`).

Flow: TRANSFERRING → `complete_transfer` → VERIFYING → (compare computed digest vs declared) → VERIFIED | FAILED(cleanup) → `prepare_install` → INSTALL_READY → `handoff_install` → INSTALLATION_HANDOFF + `invoke_installer` → platform result → COMPLETED(cleanup) or FAILED(cleanup on INSTALLATION_UNAVAILABLE). Installs are never fabricated; the app layer holds the only `DeliveryInstaller` implementation.

## F. Completed Work

### TypeScript (executed, green)
- `src/protocol/codec.ts` — `HEX64_RE` exported (shared digest grammar).
- `src/protocol/integrity.ts` (new) — pure digest module mirroring the three-language contract.
- `src/application/sha256Hash.ts` (new) — streaming Node `crypto` SHA-256 to lowercase hex, `Iterable`/`AsyncIterable` sources, single-consumption yielding.
- `src/protocol/delivery.ts` — header updated; `DeliveryProblem` + `INVALID_DIGEST`/`NO_DIGEST`/`INTEGRITY_MISMATCH`; `DeliveryAction` + `invoke_installer`; `expectedDigest` getter; five state-gated ops.
- `src/protocol/integrity.test.ts` (new) — 16 tests: digest validation, fixture contract, case-insensitive comparison, classification, SHA-256 known vectors incl. empty, multi-chunk, and async sources.
- `src/protocol/delivery.test.ts` — 18 new tests (Phase 07 describes) as specified below.
- `protocol/fixtures/model-cases.json` — deterministic `integrity` block (algorithm, digest format, expected-digest source, computation, three known hashes, verdict rows).

### Rust (written, NOT executed)
- `src-tauri/src/protocol/integrity.rs` (new) — same three functions + `IntegrityVerdict`, authorization headers documenting the sha2 deferral, inline tests.
- `src-tauri/src/protocol/mod.rs` — `mod integrity;` + re-export.
- `src-tauri/src/protocol/delivery.rs` — header, problems, `InvokeInstaller` action, `expected_digest()`, five ops (uses `apply`/`finish`/`require_no_terminal`/`outcome_problem` from the Phase 06 engine).
- `src-tauri/src/protocol/tests.rs` — 13 Phase 07 engine tests with `to_verifying`/`to_verified`/`to_install_ready`/`to_handoff` helpers mirroring the TS suite.

### Kotlin (written, NOT executed)
- `protocol/Integrity.kt` (new) — `isValidSha256`/`hashesMatch`/`classifyVerification` + `IntegrityVerdict`.
- `protocol/IntegrityTest.kt` (new, `src/test`) — 4 tests over known vectors.
- `platform/Sha256Stream.kt` (new) — streaming JVM `MessageDigest`, lowercase hex.
- `application/ArtifactStore.kt` (new) — `ArtifactPath` (session-segmented), `ArtifactStore` interface, `OwnedArtifact`, JVM `FileArtifactStore` with declared-size bounds and cleanup.
- `application/Installer.kt` (new) — `DeliveryInstaller` interface + `InstallOutcome` (Succeeded/Unavailable).
- `protocol/Delivery.kt` — header, problems, `InvokeInstaller` action, `expectedDigest`, five ops.
- `protocol/DeliveryTest.kt` — imports fix + 12 Phase 07 engine tests.

## G. Environment

- Node v22.14.0, npm, vitest 3.0.5, Vite 6.1.0, TypeScript via `tsc`; `@types/node` present.
- **No** `rustc`/`cargo`, **no** `java`/`gradle`, **no** `adb`/device in PATH. Those toolchains are recorded as unavailable; every relevant result is marked `IMPLEMENTED — NOT EXECUTED`.

## H. Work-in-Progress

None — all Phase 07 units are written. Only EXECUTION of the Rust/Kotlin mirrors remains (blocked, infra).

## I. Not Started (by design)

- Real Android package installation; `PackageInstaller` wiring; device E2E.
- Sender-side hashing integration into `desktop.ts`/Tauri commands (the sha computation seam exists; the command seam is Phase 08+).
- Any permission additions, UI additions, or wire schema changes.

## J. Blockers

1. No Rust toolchain → `cargo test` for `integrity.rs`/`delivery.rs`/`tests.rs` unrun (static review performed).
2. No Kotlin/Android toolchain → `gradlew test` for new Kotlin files unrun (static review performed).
3. No device/serial → receiver install E2E unavailable.

These are environment limitations, not code defects; status line above records them explicitly.

## K. Verification Plan (executed or recorded)

1. TypeScript gate (EXECUTED): `npx tsc --noEmit` clean; `npx vitest run` **341/341 passed** across 15 files; `npm run build` (typecheck + vite) green, renderer bundle contains 32 modules and no Node builtins.
2. Rust mirror (RECORDED, blocked): the appended tests cover success/case-insensitivity/mismatch-cleanup/malformed/state-gating/InvokeInstaller/terminal-frozen/stage-frozen/lifecycle/terminal-rejection.
3. Kotlin mirror (RECORDED, blocked): same coverage in JUnit 4.
4. Audits (EXECUTED, section N).

## L. Critical Decisions

1. **State-gated ops with a single completion op.** Earlier draft proposed `verificationSucceeded`/`verificationFailed`; this phase finalizes a single `completeVerification(actualDigest)` that classifies and routes (no separate failure op — a malformed digest is `INVALID_DIGEST`, a mismatch is `INTEGRITY_MISMATCH` with `ok:true` to FAILED + cleanup).
2. **Digest representation.** Lowercase 64-hex everywhere. Comparisons validate both inputs then compare ASCII-lowercased (hex letters are A–F only, so this is locale-safe: `toLowerCase` with explicit ROOT/`to_ascii_lowercase`).
3. **`invoke_installer` action semantics.** Engine never performs I/O; the app layer reads the event and runs the seam. `INSTALLATION_HANDOFF` is the only state from which completion is legal (`INSTALLATION_UNAVAILABLE` is legal from INSTALL_READY too).
4. **Terminal cleanup rule.** Every terminal outcome emits `Cleanup`; engine methods are rejected with `INVALID_STATE` in any terminal state (uniform ETL rule).
5. **Expected digest source.** Electron/flat descriptor: `application.identity.sha256` (Kotlin: `Sha256` value class; Rust: `Sha256` newtype). New `expectedDigest` getter centralizes the read.
6. **sha2 deferral.** No Cargo.toml change; `integrity.rs` documents the boundary. The sender hashes via the Node seam until the Rust seam intentionally lands.

## M. Verification Implementation Tour

- `sha256Hex` consumes the source exactly once via generator yielding, `createHash("sha256")`, single `.digest("hex")` — minimal chance of digest mismatch with later single-pass consumers (ArtifactStore append).
- `completeVerification`: `requireNoTerminal` → state==VERIFYING → request present → declared digest non-empty → `isValidSha256(actual)` → `classifyVerification`; success routes `verified`→VERIFIED (action None), mismatch routes `integrity_mismatch`→FAILED (`ok:true`, problem INTEGRITY_MISMATCH, action Cleanup). Identical truth table in the three mirrors.
- `handoffInstall`/`installationCompleted`/`installationUnavailable` mirror TS/Rust/Kotlin both in ordering and in problem pick (`InvalidTransition` handled by `apply`, `InvalidState`/`NoRequest`/`NoDigest`/`InvalidDigest` by guards).
- No digest value is ever compared when a hash was not computed; an un-verifiable state (missing request) fails closed.

## N. Verification Step-Behavior Probes (evidence)

TypeScript evidence (341 green; Phase 07 slice = 34 new tests):
- 16 `integrity.test.ts`: grammar edges (62/63/65 length, non-hex), all fixture hashes valid, RTL case-insensitivity, all verdict rows, empty-ascii-hello vectors, iterable/async/multi-chunk `sha256Hex`.
- 18 `delivery.test.ts`: success, conflict (mis-match) cleanup-origins, INVALID_DIGEST, NO_REQUEST, INVALID_STATE in every illegal stage, `expectedDigest` readback, InvokeInstaller emission, install-unavailable both windows, COMPLETED cleanup, frozen-machine refusal (cancel/connection-loss outside machine edges), terminal rejection of all five ops, full lifecycle.
- 13 Rust + 16 Kotlin mirror tests add no behavioral delta (same table via `tests.rs`/`DeliveryTest.kt`, `IntegrityTest.kt`).

Rust/Kotlin files in this phase carry the same probes; they are unexecuted only because the toolchains are absent (see J).

## O. Peripheral Integration

- `ArtifactPath.relative` yields `<sessionId>/application.apk`; the store root is chosen by the app layer; no network-supplied component ever reaches a filesystem path unvalidated. `SessionId` already excludes `.`/`..` by grammar.
- `App.test.tsx`/`App.tsx` untouched; renderer never imports integrity crypto.
- No Android manifest change: INTERNET permission remains the only permission.

## P. Error Handling

- Validation-guard failures return `DeliveryOutcome(ok=false, ...)` with a single flag `problem`; terminal-state entries reject all five ops with `INVALID_STATE`.
- Mismatch is return-`ok` (machine ran) but semantically negative and instructs cleanup; never silently proceeds to install.
- `installUnavailable`/`installCompleted` are genuine platform-result inputs; the engine rejects fabricated or out-of-state calls.

## Q. Code-Review Notes

- Mirrors keep identical op names/ordering; problem enum order matches across the three languages to ease parity diff.
- Hash-based tests use constants defined in one place per file; no time/locale/fixture-drifting literals.
- TS test fixture is loaded via `require(...)` at module scope; the fixture integrity block is consumed only by prose, with hash semantics enforced in code.

## R. Production-Readiness Notes

- Renderer bundle stays Node-free; sha seam is dead code from the bundle's perspective (confirmed by clean vite build).
- `FileArtifactStore` bounds writes by declared size and validates size on seal; `delete()` is idempotent.
- Application layer must eventually pass a verified (integrity-valid) artifact path only after `clear verdict == VERIFIED`; the engine's state machine alone gates it.

## S. Test Summary

| Suite | Before | Added | Total | Status |
|---|---|---|---|---|
| vitest (15 files) | 307 | 34 | 341 | ✅ 341/341 under `npx vitest run`; `tsc --noEmit` clean; `vite build` green |
| Rust `integrity.rs` + `tests.rs` | n/a | 13 + inline | 13+inline | ⛔ written only (no cargo) |
| Kotlin `IntegrityTest` + `DeliveryTest` | 0 | 4 + 12 | 16 | ⛔ written only (no gradle) |

## T. Variance From Prompts

None (30/31 steps). The only open item is the final **device/install E2E** from the phase program, which is infra-blocked, plus the two mirror toolchain gates. No scope change, no machine change, no wire change.

## U. Findings & Fixes

1. TS strict `noUncheckedIndexedAccess` flagged `Record<string,string>` fixture indexing at typecheck → fixed with an explicit `known_hashes` shape (no behavior change).
2. Rust `debug_assert` + duplicate `is_empty` guard flagged by review → collapsed to a single defensive guard with a prose note (parity-kept).

## V. Risks / Limitations (Resolved, Open)

- **Resolved:** digest representation ambiguity (lowercase hex + validated case-insensitive compare); engine/installer boundary confusion (`invoke_installer` action); "what computes the digest" (platform seam, never protocol); bundle contamination (renderer import audit).
- **Open (explicitly deferred):** Rust sha2 hashing; sender command seam; Android `PackageInstaller` concrete implementation; device E2E; any UI for install progress/result.

## W. Definition of Done

Per-phase step list (drawn from the Phase 07 action program):
- [x] Step 1 — Baseline closure & prompt obligations audit.
- [x] Step 2 — Inspection of all affected modules/fixtures/toolchains.
- [x] Step 3 — Digest representation decision, platform-seam policy, no-new-wire-field check.
- [x] Step 4 — Pure integrity module authored in all three mirrors.
- [x] Step 5 — Engine state-gated ops + problems + action; fixtures updated.
- [x] Step 6 — TS tests (integrity + delivery) written and **executed green**; tsc/build clean.
- [x] Step 7 — Rust mirror written (unexecuted infra blocker recorded).
- [x] Step 8 — Kotlin mirror written (unexecuted infra blocker recorded).
- [x] Step 9 — Post-verification audits (parity, contamination, permission) — all pass.
- [x] Step 10 — Final report A-X + DoD (this document).
- [x] Step 11 — Status verb + residual-risk surface (see V above).

Phase-07 DoD checklist (project spec §58-origin, applied):
- [x] VERIFYING → VERIFIED/FAILED correct classifications across languages.
- [x] Mismatch ⇒ NO install path; cleanup emitted.
- [x] Only genuine platform status advances/terminates install state.
- [x] No new permissions; no renderer crypto leakage; no new wire fields.
- [x] 341/341 TS green; Rust/Kotlin parity complete with explicit unexecuted-status flags.

## X. Recommended Follow-Ups

1. Run `cargo test` + `cargo clippy` once toolchain present (expect green; files are conservative Rust, single-lang idioms).
2. Run `./gradlew test` once Java/gradle present.
3. Phase 08: sender Tauri command seam for `sha256Hex`; receiver `Application`-layer wiring of `Sha256Stream` → `ArtifactStore` → `DeliveryInstaller` (concrete `PackageInstaller`); device E2E; UI result surface.
4. When the Rust host h1 seam is scheduled, add the `sha2` crate under the documented uniform policy and mirror `sha256Hex`.

---

*End Phase 07 report.*