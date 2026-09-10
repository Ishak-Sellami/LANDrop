# LanDrop — Security Posture (Phase 09 Security Documentation)

> **Phase 09 documentation.** Records the security posture, controls, and operational guidance as implemented and validated at Phase 09. Not a historical requirements document.

Date: 2026-09-10 · Status: `SECURITY REVIEW COMPLETED + FINDINGS / MITIGATIONS / RESIDUAL RISKS`

## 1. Posture Summary

- **Install safety is the primary invariant.** No code path may invoke the installer except the delivery engine after `VERIFIED` (V2/V3 pins, Invariant 9/10).
- **Integrity is mandatory**: every staged artifact is sealed with a SHA-256 digest and `completeVerification` is the only gate that unlocks install staging (§20–§21).
- **No silent install**: install requires an explicit user `ACCEPT` decision.
- **Input validation is defense-in-depth**: strict JSON grammar, identifier regexes, size/depth caps, strict UTF-8, latched fail-closed frame decoder.
- **Total-rejection discipline (F-01)**: a rejected engine apply is *void and inert* — it carries no event, no inherited state, and `action=None`.

## 2. Controls Implemented (validated)

| Control | Location | Evidence |
|---|---|---|
| 18-state delivery machine (sole gating authority) | `state-machine.ts` / `state_machine.rs` / `DeliveryStateMachine.kt` | exhaustive matrix, terminal freeze (security.test.ts, DeliveryStateMachineTest) |
| SHA-256 verdict table | `integrity.ts` / `Integrity.kt` | integrity.test.ts (16), security.test.ts |
| Install gating + INTEGRITY_MISMATCH fail path | `completeVerification`, coordinators | security.test.ts `install-gating-after-verified` |
| Hostile `package_name` rejection | PACKAGE_RE (codec.ts), ApkIdentity (Kotlin), Identifiers (Rust) | security.test.ts `metadata-path-vectors`, SecurityTest.kt mirror |
| JSON depth cap 16 / bytes cap 65536 | codec / `checkInput` / Rust JSON5-bounded read | depth-bomb tests both stacks |
| Frame fail-closed latch | `framing.ts` / `Framing.kt` / Rust | over-limit ⇒ permanent FRAME_TOO_LARGE; valid trailing frame refused |
| Duplicate-key last-value-wins determinism | kotlinx.serialization + JSON.parse (TS) | security.test.ts duplicate-key tests |
| F-01 side-effect guard on rejection | `delivery.ts` / `Delivery.kt` / `delivery.rs` | 3 regression tests (TS), 4 mirror tests (Kotlin) |
| Receiver fail-closed staging | `ReceiverCoordinator.afterVerified` (`prepareInstall`/`handoffInstall` failure ⇒ `store.delete()`) | code review only (Kotlin not executable) |

## 3. Supply-Chain Note (dependency audit)

- Production (`npm audit --omit=dev`): **0 vulnerabilities**.
- Development-only residual: `vitest`/`@vitest/mocker` **moderate** (GHSA-82fw-gwwq-j7x9). Fix requires vitest **5.0.0** (major, out of Phase-09 in-range policy). Non-applicable to runtime: the repo performs no `vi.mock`/redirect mocks. esbuild/vite advisories were cleared by the in-range bump to vite **6.4.3** (esbuild 0.25.12).
- Toolchain upgrade policy: in-line, in-range, additive bumps only; majors deferred and recorded.

## 4. Operational Guidance (conscious of limits)

- Run in the device's LAN environment. The current trust model assumes a LAN attacker is **not** present; device/tofer128auth (protocol §39) and a TLS PKI model (transport §29) remain open.
- Do not weaken validation flags in production (no flags exist by design).
- Re-run `node node_modules/vitest/vitest.mjs run` before each release; target 382 tests green (17 files) plus the Kotlin/Rust suites once toolchains exist.
- Keep `docs/threat-model.md` and this file in sync whenever delivery-state, integrity, or install-gating rules change.

## 5. Residual Risks (short)

1. TOCTOU `VERIFIED → INSTALL_READY → INSTALLATION_HANDOFF` (single-writer discipline; not OS-confined).
2. No peer auth / TLS PKI / replay-dedupe — all recorded as deferred spec gaps.
3. Hard-coded resource bounds (bytes/depth/identifier length) not configurable.
4. Rust/Kotlin mirrors not executed yet (TypeScript executed green).