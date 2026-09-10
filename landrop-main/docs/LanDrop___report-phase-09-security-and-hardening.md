# Phase 09 — Security Hardening & Threat-Driven Validation — Implementation Report

**Status:** `PHASE 09 COMPLETE — WITH UNEXECUTED TOOLCHAIN SECURITY VERIFICATION`
**Date:** 2026-09-10
**Locale clock:** MSK (UTC+3), matches protocol-grade fixture timestamps

This report is the Phase 09 deliverable for the strict spec-driven 31-step program. It references the frozen Phase 01–08 baselines. Section labels follow the mandated **A–AE** scheme from the Phase 09 prompt (§45); sections D/E/F carry the phase-required asset, data-flow, and threat-model content.

---

## A. Closed Baseline References (Definition of Done input)

| Item | Reference |
|---|---|
| Protocol spec | `protocol/LanDrop___protocol-protocol-spec.md` (§2 message classes, §6 version gate, §17–§18 binary plane + declared size, §20 SHA-256, §21 verification truth table, §23 install, §31 transfer progress, §36 untrusted metadata) |
| Project spec | `LanDrop___PROJECT_SPECIFICATION.md` (§19–§21 install/integrity, §21 path security, §34 malicious input, §36 network-provided names, §39 authentication) |
| Architecture doc | `docs/LanDrop___docs-architecture.md` (§19–§20, §27–§28, §32 security architecture, §33 threat model summary, §34 auth limitation, §38 data ownership, §44 invariants) |
| Phase 02 frozen baseline | Codec/ErrorCodes — payload grammar, strict JSON, identifier regexes |
| Phase 03 frozen baseline | 18-state Delivery State Machine — **not modified** in Phase 09 (machine pins tested, not changed) |
| Phase 04–06 baselines | transport, framing, message-stream, discovery, connection, secure channel, session establishment, engine |
| Phase 07 baselines | integrity, install staging (`prepareInstall`/`handoffInstall`/`installationCompleted`/`installationUnavailable`), `invoke_installer` action |
| Phase 08 baselines | application-layer coordinators, `delivery-flow` recording, Temp-Store ownership (Invariant 9/10) |
| Dependency baseline | `package.json` at Phase 08: vite 6.1.0, vitest 3.0.5 |

## B. Report Date

All toolchain executions in this report ran on **2026-09-10** at the relocated root `C:\Users\lenovo\Desktop\LANDrop\landrop-main`. Byte-for-byte hashes and frame boundaries in tests are independent of date/locale.

## C. Inputs

1. The Phase 09 action prompt (strict phases, steps, status verbs, final report A–AE, §45–§50).
2. `protocol/LanDrop___protocol-protocol-spec.md` §2, §6, §17–§21, §23, §31, §36.
3. `LanDrop___PROJECT_SPECIFICATION.md` §21, §34, §36, §39.
4. `docs/LanDrop___docs-architecture.md` §32–§34, §38, §44.
5. Phase 04–08 code, fixtures, and the un-modifiable machine baselines (`state-machine.ts`, `state_machine.rs`, `DeliveryStateMachine.kt`).

## D. Assets & Trust Boundaries (Phase-09 §45-D)

- **Assets**: in-transit APK bytes; staged (verified) APK file (`ArtifactStore`); SHA-256 digests; delivery machine state; install handoff; control-plane JSON.
- **Trust boundaries**: (1) *wire* — LAN peer is untrusted, identity **not authenticated** (§39 / arch §34 deferral); (2) *verification* — hash verdict is the only input that may unlock `VERIFIED`; (3) *install* — PackageInstaller reachable only via `InvokeInstaller`/`InvokeInstaller`-governed actions after `VERIFIED` (Invariant 9/10); (4) *human* — `ACCEPT` decision required; no silent install.
- Full table: `docs/threat-model.md §1–§2` (created Phase 09).

## E. Data Flow & Attack Surface (Phase-09 §45-E)

Attack-surface entry points (all untrusted-external): discovery payloads, session/connection/secure-channel establishment, control frames (length-prefixed) and JSON messages, metadata fields (`package_name`, `size_bytes`, `sha256`, presentation), transfer plaintext bytes, cancel/decision/response messages.

Flow to defend: Peer → discovery → session → control codec → delivery engine → (ok) → transfer plane → byte accounting → SHA-256 verdict → install staging → handoff → PackageInstaller (`docs/security.md §1`, `docs/threat-model.md §3`).

## F. Threat Model (STRIDE) — Phase-09 §45-F

| Threat | Control | Residual |
|---|---|---|
| Spoofing | state-gating; strict failure routing to FAILED before trust | no peer auth / TLS PKI (deferred) |
| Tampering | `hashesMatch` gate; strict JSON + regex metadata; fail-closed decoder | TOCTOU verified→handoff (single-writer discipline only) |
| Repudiation | `observer`/`recordAction` traces | no signed audit log |
| Disclosure | problem codes only; user-shared metadata by design | mDNS/broadcast of hostname:port |
| DoS | frame 65536 / JSON 65536 / depth 16 / identifier length caps; latched decoder | no resource-limit policy constants; no replay/dedupe (spec gaps) |
| Elevation | V2/V3 PINs; terminal freeze; F-01 total-rejection | installer not OS-further-isolated |

Full STRIDE table: `docs/threat-model.md §4`.

## G. Environment

- Shell: Windows PowerShell 5.1 (blocks `.ps1`; `npm.cmd` works). Workdir for executions: `C:\Users\lenovo\AppData\Local\Temp\opencode` + absolute paths.
- Node/npm present. **NO** JVM, Kotlin, Gradle, Android SDK/emulator, Rust toolchain, or Java — see J.
- Toolchain paths used: `node node_modules/vitest/vitest.mjs run`; `node node_modules/typescript/bin/tsc --noEmit`; `node node_modules/vite/bin/vite.js build`; `npm.cmd audit`.

## H. Work-in-Progress

- Evergreen v2/v3 + F-01 security suite and docs live at their final locations; Phase 09 scope is otherwise complete pending toolchain verification (J).

## I. Not Started (by design)

- Peer authentication, TLS PKI / certificate model, replay/dedupe, session&transfer timeouts policy, transfer-id wire carrier, install-result wire feedback, fuzzing harnesses, Android emulator/E2E — all outside Phase-09 scope; recorded as open deferred items (protocol §39 and transport §29 gaps).

## J. Blockers

- No executable Kotlin/JVM/Android toolchain and no Rust toolchain → `SecurityTest.kt` and `delivery.rs` edits are code-reviewed only, **NOT executed**. Honesty rule applies: no claim of passage for unexecuted suites.

## K. Verification Plan (executed or recorded)

| Check | Where | Status |
|---|---|---|
| Full TS suite | vitest run, 17 files | `382 passed` (executed) |
| TypeScript strict typecheck | `tsc --noEmit` | exit 0 (executed) |
| Production build | `vite build` | green, `index-CTEe3cS9.js` 189.00 kB / gzip 59.72 kB (executed) |
| Production dependency audit | `npm.cmd audit --omit=dev` | `0 vulnerabilities` (executed) |
| Dev dependency advisory record | full `npm audit` | 2 moderate residual (recorded; see Z) |
| Kotlin mirror suite | `SecurityTest.kt` | written, **NOT executed** |
| Rust guards | `delivery.rs` | reviewed by inspection, **NOT compiled** |

## L. Critical Decisions

1. **F-01 hardened with `if (!applied.ok) return applied;`** in every engine op that wrapped `finish()` — TS, Kotlin, Rust parity (total-rejection invariant). No machine change; machine files untouched.
2. **Receiver fail-closed**: a `prepareInstall()`/`handoffInstall()` rejection in `afterVerified` now deletes the staged artifact instead of returning silently.
3. **Dependency bump, in-range only**: vite 6.1.0→6.4.3, vitest 3.0.5→3.2.7 (dev-only; vitest 5.0.0 major declined as out of policy).
4. **Fixture as single source**: Phase-09 `security` block lives in `model-cases.json`; TS suite consumed via resolved path; Kotlin mirror drives the same vectors by construction protocol (not executed).
5. **Last-value-wins documented** as the duplicate-key policy (structural JSON semantics, both stacks).

## M. Verification Implementation Tour

- `sender/desktop/src/protocol/security.test.ts` (32 tests): machine conformance exhaustive 18×21; V2/V3 PINs; engine conformance battery along the receiver path (11 steps, 30-ops terminal battery); terminal seal; F-01 regressions; metadata path vectors; duplicate-key determinism; depth bombs (17/32/64/1024); frame boundaries at/over/zero limit incl. fail-closed latch.
- `receiver/android/.../protocol/SecurityTest.kt` (mirror, NOT executed): the same harness on `DeliveryEngine`/`DeliveryStateMachine`/`ProtocolJson`/`JsonMessageStream`.

## N. Verification Step-Behavior Probes (evidence)

- Pins: `VERIFYING + INSTALL_PREPARED/HANDOFF_INITIATED/COMPLETED` and `TRANSFERRING + same` ⇒ `Rejected`.
- Frame boundary: header `0x00010000` (65536) ⇒ `Incomplete`; header `0x00010001` (65537) ⇒ `FrameError(FRAME_TOO_LARGE)`; a valid `delivery_response` frame offered afterwards is **still refused** (latched).
- Depth: `{"a":` ×17+ ⇒ `json.depth` failure (cap 16), thresholds 17/32/64/1024 all rejected.
- Metadata: `../../evil.apk`, `/data/local/tmp/evil.apk`, `C:\evil.apk`, `%2e%2e%2fevil.apk`, `..`, `com/example/application`, `com.example.application:evil` ⇒ all rejected; `com.example.application` ⇒ accepted.
- F-01: `expire()`/`connectionLost()`/`processTransferCancel()`/`installationUnavailable()`/`transferTimeout()` on wrong state ⇒ `ok=false`, `action=None`, state held (TS executed; Kotlin mirror recorded).
- Install gating: `completeVerification(MISMATCH)` ⇒ `INTEGRITY_MISMATCH` ⇒ `FAILED`; `prepareInstall`/`handoffInstall` unreachable pre-`VERIFIED`.

## O. Peripheral Integration

- `ReceiverCoordinator.afterVerified` now cleans up on anomalous machine refusal (Kotlin, review-only).
- Delivery engine / machine untouched (frozen baselines preserved).

## P. Error Handling

Total-rejection discipline everywhere: rejected applies return `event=null, to=null, action=None, problem≠null`. Coordinators treat every `ok=false` as terminal for that flow and delete staging. Decoder failures are permanent (latch).

## Q. Code-Review Notes

- TS engine surface introduced no new mock/redirect paths (dev-only advisory non-applicable).
- Test-side corrections during development: bad-value `package_name` ⇒ `INVALID_METADATA` (not `INVALID_REQUEST`); `0x00010000` is at-limit (incomplete), overflow needs 65537; stream-level endOfStream outcome `frame-error`.
- Kotlin mirror uses only confirmed API shapes (`DeliveryEngine(sessionId, initialState)`; `ProtocolJson.decode(...): Result<...>`; `JsonMessageStream`; `FrameProblem` enum).

## R. Production-Readiness Notes

- Runtime dependency surface: **0 vulnerabilities**. Withheld majors documented (vitest 5).
- No telemetry, no background code execution, no silent install, no persistence-adjacent behavior introduced.

## S. Test Summary

| Suite | Files | Status |
|---|---|---|
| Baseline (Phases 02–08) | 16 files, 350 tests | green |
| Phase 09 TS security | `security.test.ts`, 32 tests | green |
| **Total executed (TS)** | **17 files, 382 tests** | **green** |
| Kotlin mirror | `SecurityTest.kt` | written, NOT executed |
| Rust guards | n/a (no harness) | inspection only |

## T. Variance From Prompts

- Only declared exceptions: Kotlin/Rust mirrors not executed (no toolchains) — reflected in the status verb; dependency majors deferred and recorded (§47 honesty rule).
- `docs/security.md` and `docs/threat-model.md` created as explicitly-labeled **Phase 09 documentation** (no historical-requirement claims).

## U. Findings & Fixes

| ID | Severity | Finding | Fix | Verified |
|---|---|---|---|---|
| **F-01** | Low (defense-in-depth) | Engine ops `expire`/`connectionLost`/`processTransferCancel` (+ Kotlin/Rust peers: `installationUnavailable`, `cancel`, `transferTimeout`) wrapped `finish()` around a **possibly-rejected** `apply()`, attaching `Cleanup`/`StopStream`/`SendMessage` actions to `ok=false` outcomes — a side-effect leak on rejection, violating total rejection. No reachable exploit (callers check `.ok` first), but the invariant was enforceable | Guard `if (!applied.ok) return applied;` in TS `delivery.ts`, Kotlin `Delivery.kt`, Rust `delivery.rs` | TS: 3 regression tests green; Kotlin: 4 mirror tests written; Rust: inspection |

Additional verification-side notes (not code findings): at-limit vs over-limit boundary semantics; `INVALID_METADATA` classification; stream-level `frame-error` endOutcome.

## V. Risks / Limitations

- Open: TOCTOU `VERIFIED→INSTALL_READY→INSTALLATION_HANDOFF`; no peer auth / TLS PKI / replay-dedupe / timeout policy (spec gaps, deferred); hard-coded resource bounds; no fuzzing harness.
- Courted risk: Kotlin/Rust untestable — parity asserted by construction, not by execution.

## W. Definition of Done

Phase-09 DoD items met: safety of install enforced elsewhere (no bypass found in machine/engine/coordinator review); no flattening/bypass of Android, TLS, SHA-256, or DeliveryState; no sig-validation bypass; no silent install; threat-driven security test suite executed (TS) and mirrored (Kotlin); dependency audit performed and residual dev-only risk recorded; docs + report produced with the mandated status verb. **Knock-on (not done):** toolchain-based verification of Kotlin/Rust mirrors.

## X. Recommended Follow-Ups

1. Provision JVM + Android SDK (+ Rust) and run `SecurityTest.kt`, DeliveryStateMachineTest, and Rust unit tests; reflect results in the status verb.
2. Fuzz control-plane codecs and frame decoder with the Phase-09 vectors as seed corpus.
3. Address spec-gap inventory: peer auth (§39), TLS PKI, replay/dedupe, timeouts, transfer-id carrier, install-result feedback.
4. Android E2E on emulator (mDNS/TCP/TLS/install handoff).

## Y. Residual Risk Register

| RR | Risk | Mitigation | Owner |
|---|---|---|---|
| R-01 | TOCTOU between VERIFIED and store delete | single-writer ownership; fail-closed delete on refusal (this phase) | Receiver |
| R-02 | LAN peer impersonation | none (auth deferred) | Protocol §39 |
| R-03 | Replay of accepted delivery | none (dedupe deferred) | Protocol §38 |
| R-04 | Resource exhaustion | hard caps active; policy knobs deferred | Protocol |
| R-05 | Unverified mirror code ships | status verb + blocking CI once toolchains exist | CI |

## Z. Dependency & Supply-Chain Record

- Pre-bump: full audit flagged dev-only `@vitest/mocker` (moderate), `esbuild` (moderate), `vite` (high), `vitest` (critical).
- Post-bump: `esbuild`/`vite` cleared via vite 6.4.3 (esbuild 0.25.12); residual dev-only **2 moderate** (`vitest`/`@vitest/mocker`, GHSA-82fw-gwwq-j7x9); prod (`--omit=dev`) **0**.
- Fix requires vitest 5.0.0 (major) — declined under the in-range policy; non-applicable at runtime (no `vi.mock` redirect mocks).

## AA. Cross-Stack Consistency Matrix

| Facility | TS | Kotlin | Rust |
|---|---|---|---|
| F-01 rejection guard | executed: green | mirror tests written | guard applied, reviewed |
| machine pins/matrix | executed: green | existing DeliveryStateMachineTest | existing (unrun) |
| metadata regex | PACKAGE_RE tested green | ApkIdentity value-class | Identifiers (unrun) |
| depth/bytes caps | executed: green | `JsonFields.checkInput` (mirror) | JSON5-bounded read (unrun) |
| frame fail-closed | executed: green | `FrameDecoder` (mirror) | (unrun) |

## AB. Security Controls (implemented / deferred)

- Implemented & validated (TS): total-rejection F-01; fail-closed decoder; depth/bytes caps; metadata identifier rule; install-gating PINs; terminal seal.
- Implemented & reviewed-only (Kotlin coordinators): fail-closed staging delete.
- Deferred (recorded): auth, TLS PKI, replay/dedupe, timeouts policy, fuzzing.

## AC. Honesty & Execution Status

- Executed: vitest 382/382 (17 files), `tsc --noEmit` exit 0, `vite build` green, prod audit 0, fixture consumed.
- Code-reviewed only: Kotlin `SecurityTest.kt`, `ReceiverCoordinator.kt`, Kotlin/Rust F-01 guards.
- Not executed and **not claimed**: any Kotlin/Rust suite, Android E2E.

## AD. Status Options Considered

Per §47 the report may carry one status verb. `PHASE 09 COMPLETE` alone would overstate confidence in the unexecuted mirrors; `...WITH UNEXECUTED TOOLCHAIN SECURITY VERIFICATION` records the exact truth: TS security validation is complete and green; Kotlin/Rust verification is written/inspected but not executed.

## AE. Final Status & Sign-off

**`PHASE 09 COMPLETE — WITH UNEXECUTED TOOLCHAIN SECURITY VERIFICATION`**

- TS security suite: **32/32 green** (382 total). TypeScript strict: clean. Build: green. Prod audit: **0 vulnerabilities**.
- Genuine finding **F-01** fixed across TS/Kotlin/Rust with regression coverage.
- Deliverables: `security.test.ts`, `SecurityTest.kt` (mirror), `ReceiverCoordinator.kt` hardening, `model-cases.json` `security` block, `docs/threat-model.md`, `docs/security.md`, this report.
- Open and honest: no claims beyond the executed verification. Residual A-risks documented in Y.

— Phase 09 completed and signed-off per §47 verb.