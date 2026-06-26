# ios-sanity-runner

State-aware, end-to-end UI **sanity/smoke** test runner for iOS apps. Installs a
build, drives the UI (Simulator or physical device), branches on the user's
runtime state, and reports pass/fail. Test cases are human-authored YAML; the
engine is a clean, importable TypeScript module so it can be dropped into
another tool as a sub-module.

> **MVP status (Phase 0–1):** engine, registry, OTP login, state-branching DSL,
> reporting, device discovery, and module build are implemented and verified
> (`npm test`, `npm run typecheck`, `npm run build`, `npm run doctor`). Driving a
> live UI additionally requires **full Xcode + the Appium xcuitest driver** —
> see [Prerequisites](#prerequisites). The orchestration was verified
> end-to-end against a connected device up to the Appium session boundary.

---

## Why this exists / design at a glance

- **State-aware, not linear.** The app looks different per user type. Cases
  branch on the state *detected at runtime* (`branch: on: detected_user_state`),
  and a **drift check** after login fails loudly if a seeded account is no
  longer in its declared state.
- **Credentials live in one file.** A central [account registry](#account-registry)
  maps each user state to a *pool* of accounts. A case says `requires:
  SUBSCRIBED_USER`; the engine leases a matching account. Credentials never
  appear in a case.
- **OTP is pluggable.** Login is OTP/SMS based. The code retrieval strategy
  (`bypass` / `twilio` / `backend_endpoint`) is a **config change, not a code
  change**. Default is `bypass`.
- **Importable module.** Everything is exported from `src/index.ts`; the CLI is
  just one consumer. `npm run build` emits `dist/` with `.d.ts` for integration.

---

## Prerequisites

Run the doctor first — it tells you exactly what's missing:

```bash
npm install
npm run doctor
```

| Requirement | Needed for | Install |
|---|---|---|
| Node ≥ 22 | the runner (native TS, no transpile) | — |
| **Full Xcode** (not just Command Line Tools) | XCUITest/WebDriverAgent → driving ANY UI (sim or device) | App Store / developer.apple.com |
| `simctl` | Simulator targets | ships with Xcode |
| Appium ≥ 2 + **xcuitest** driver | the automation session | `npm i -g appium && appium driver install xcuitest` |
| libimobiledevice | device discovery + `.ipa` install | `brew install libimobiledevice ideviceinstaller` |
| Apple signing (dev/ad-hoc) | WebDriverAgent on a **real device** | Xcode signing + `wda` config block |

**If the doctor says "Command Line Tools only":**
```bash
sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept && xcodebuild -runFirstLaunch
appium driver install xcuitest
```

---

## Quick start

```bash
# 1. Configure (both files are gitignored)
cp config/accounts.example.yaml      config/accounts.yaml
cp config/runner.config.example.yaml config/runner.config.yaml
#    → fill in real test numbers + the app bundleId + login locators

# 2. Start Appium in another terminal
appium

# 3. Run
npm run doctor                                    # preflight
node src/cli.ts --suite suites/home_entitlement_sanity.yaml --target device
node src/cli.ts --all --target simulator          # run every suite
node src/cli.ts --all --parallel 3 --lock-dir .leases   # parallel + cross-process safe leasing
```

**CLI flags:** `--suite <file>` / `--all`, `--target simulator|device|any`,
`--udid <id>`, `--parallel <n>` (bounded concurrent suites), `--lock-dir <dir>`
(file-lock account leasing across processes — for parallel shards / a farm),
`--config`, `--accounts`, `--suites`.

Artifacts land in `artifacts/`: `junit.xml` (CI), `report.html` (humans), plus
`page-source.xml` + `screenshot.png` per failed suite.

---

## Build sources → target (iOS signing reality)

| Source | Runs on | Install | Notes |
|---|---|---|---|
| `.app` (simulator slice) | **Simulator only** | `simctl install` | unsigned |
| device-signed `.ipa` | **Physical device only** | `ideviceinstaller -i` | needs valid provisioning + registered UDID |
| TestFlight build | physical device | TestFlight app / pre-upload `.ipa` | App-Store-signed; **cannot** run on Simulator |
| pulled from device | matching devices only | `ideviceinstaller --archive` | device-signed; mainly to re-test what's installed |

> A TestFlight/App-Store `.ipa` **cannot run on the Simulator** — the sim needs
> a `.app`. Recommended: have CI emit **two artifacts per build** (a Simulator
> `.app` and a dev/ad-hoc `.ipa`) and feed both via `LocalBuildProvider`.

---

## Account registry

`config/accounts.yaml` (gitignored) is the single source of truth. Multiple
accounts per state = a pool for parallel runs + rotation. See
`config/accounts.example.yaml`.

A test references a state, never a credential:

```yaml
requires: SUBSCRIBED_USER     # engine leases a matching account from the pool
```

Add/remove/swap an account = edit that one file. Adding a whole new **state**
touches exactly three places: the `USER_STATES` list in `src/types.ts`, a block
in `accounts.yaml`, and a `branch`/matrix row in the relevant suite.

---

## Test DSL

See `suites/home_entitlement_sanity.yaml` for a worked, branching example.

- **Locators** (priority order, pick exactly one): `accessibility_id` ▸
  `predicate` ▸ `class_chain` ▸ `xpath` ▸ `text` ▸ `coordinates` (last resort,
  flagged fragile).
- **Actions:** `tap`, `type`, `swipe`, `scroll`, `wait_for`, `assert_visible`,
  `assert_not_visible`, `assert_text`, `fail`.
- **Control flow:** `branch: { on: detected_user_state, cases: {...} }`,
  `use_flow: <name>` (reusable flows under `flows:`).
- **State matrix:** define `matrices: { <name>: { <STATE>: { visible: [...],
  absent: [...] } } }` and assert with `assert_matrix: { matrix: <name> }`. The
  engine expands the row for the detected state — adding a new state is one row,
  not a new branch. See `suites/home_entitlement_matrix.yaml`.
- **Setup verbs:** `login: { otp: auto }`, `assert_state: <STATE>` (drift check).

---

## Architecture

```
Run Controller ─┬─ Build Acquisition (local · testflight · device-extract)
                ├─ Device/Sim Manager (simctl · libimobiledevice)
                ├─ Appium Session (webdriverio + xcuitest)
                │     ├─ Locator Engine (priority ladder)
                │     └─ Action Runner (tap/type/assert/branch)
                ├─ OTP Login Handler (bypass · twilio · backend) ← pluggable
                ├─ Account Registry (resolve-by-state, pool lease)
                ├─ State Detector + Drift Check
                └─ Reporter (JUnit + HTML + screenshots)
```

Module map: `src/engine` (orchestration), `src/devices`, `src/build`,
`src/session`, `src/locators`, `src/actions`, `src/otp`, `src/login`,
`src/state`, `src/registry`, `src/reporter`, `src/suite` (schema + loader),
`src/config`. Public API: `src/index.ts`.

---

## Roadmap

- **Phase 0 — Foundations (done):** engine, YAML loader+schema, action runner,
  registry, bypass OTP, reporting, doctor, device discovery. Verified via tests.
- **Phase 1 — State-awareness (done):** pool leasing, pluggable OTP, drift
  check, branching DSL + state matrix, full example suites.
- **Phase 2 — Real device (pending Xcode):** WDA signing, `.ipa` install,
  `--target device`. *Blocked only on a live Xcode env to execute against a
  device — code paths are in place.*
- **Phase 3 — Parallelism + farm (foundations done):** `--parallel` bounded
  concurrency, `DevicePool`, cross-process file-lock leasing (`--lock-dir`).
  Remaining: a remote farm `DeviceManager` (BrowserStack/Sauce/AWS/self-hosted).
- **Phase 4 — CI (started):** CI runs typecheck+tests+build on every PR. Remaining:
  macOS runner with a device/sim, TestFlight provider, scheduled gate, swap OTP
  to Twilio/backend if test numbers receive real SMS.

---

## Development

```bash
npm test          # unit tests (node:test, native TS)
npm run typecheck # tsc --noEmit (erasableSyntaxOnly — no transpile needed to run)
npm run build     # emit dist/ + .d.ts for module integration
npm run doctor    # environment preflight
```
