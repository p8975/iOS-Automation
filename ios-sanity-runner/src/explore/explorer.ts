/**
 * Orchestrates one autonomous exploratory crawl end-to-end against one target,
 * emitting the SAME {@link RunEvent} stream as a normal run so the live
 * dashboard renders it with no special-casing. Sets up device + session + login
 * exactly like RunController (state-aware account leasing), then hands a live
 * {@link AppiumProbe} to the pure crawler.
 *
 * Mapping: an exploration is one run with a single suite, `exploration`, whose
 * steps stream in as each screen is reached and each control is tapped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunnerConfig } from '../config/config.ts';
import type { AccountRegistry } from '../registry/accountRegistry.ts';
import type { RunObserver } from '../events/runEvents.ts';
import type { AccountLease, StepResult, SuiteResult, Target, UserState } from '../types.ts';
import { SimulatorManager } from '../devices/simulator.ts';
import { PhysicalDeviceManager } from '../devices/physicalDevice.ts';
import { AppiumSession } from '../session/appiumSession.ts';
import { LoginHandler } from '../login/loginHandler.ts';
import { autoLogin, isLoginScreen } from '../login/appLogin.ts';
import { createOtpProvider } from '../otp/index.ts';
import { DEFAULT_DENY } from './denylist.ts';
import { crawl, type CrawlOptions } from './crawler.ts';
import { AppiumProbe } from './appiumProbe.ts';

const SUITE = 'exploration';

export interface ExploreParams {
  runId: string;
  state: UserState;
  target: Target;
  observer: RunObserver;
  /** Cooperative cancellation (the Stop button aborts this). */
  signal?: { aborted: boolean };
  preferredUdid?: string;
}

export class Explorer {
  readonly #config: RunnerConfig;
  readonly #registry: AccountRegistry;

  constructor(config: RunnerConfig, registry: AccountRegistry) {
    this.#config = config;
    this.#registry = registry;
  }

  #resolveTarget(target: Target): Target {
    if (target === 'any') return this.#config.defaultTarget === 'any' ? 'device' : this.#config.defaultTarget;
    return target;
  }

  /** Record the current screen as a judged `screen:` step (screenshot + element inventory). */
  async #captureScreen(probe: AppiumProbe, name: string, onStep: (step: StepResult) => void): Promise<void> {
    const t0 = new Date().getTime();
    let elements: string[] = [];
    try {
      elements = (await probe.interactive()).map((c) => c.label).filter((l) => l.trim().length > 0);
    } catch {
      /* best-effort */
    }
    let shot: string | undefined;
    try {
      shot = await probe.capture(name);
    } catch {
      /* best-effort */
    }
    let health: { ok: boolean; problem?: string } = { ok: true };
    try {
      health = await probe.health();
    } catch {
      /* best-effort */
    }
    onStep({
      ok: health.ok,
      action: 'screen: ' + name,
      detail: 'login flow',
      error: health.ok ? undefined : health.problem,
      screenshotPath: shot,
      elements,
      durationMs: new Date().getTime() - t0,
    });
  }

  async run(params: ExploreParams): Promise<SuiteResult> {
    const { runId, observer, signal, state } = params;
    const target = this.#resolveTarget(params.target);
    const startedAt = new Date().toISOString();

    observer({ type: 'run_started', runId, startedAt, total: 1, suites: [{ suite: SUITE, state, target }] });
    observer({ type: 'suite_started', runId, suite: SUITE, target, state, startedAt });

    const steps: StepResult[] = [];
    let stepIndex = 0;
    const onStep = (step: StepResult): void => {
      steps.push(step);
      observer({ type: 'step_finished', runId, suite: SUITE, target, index: stepIndex++, step });
    };

    const ec = this.#config.explore ?? {};
    const opts: CrawlOptions = {
      // Project deny terms EXTEND the built-in safe defaults (they don't replace
      // them) — so a config `explore.deny` can never silently drop the financial
      // /account-state protections.
      deny: [...DEFAULT_DENY, ...(ec.deny ?? [])],
      maxSteps: ec.maxSteps ?? 60,
      maxDepth: ec.maxDepth ?? 3,
      maxScreens: ec.maxScreens ?? 40,
      perScreenTaps: ec.perScreenTaps ?? 6,
      timeBudgetMs: ec.timeBudgetMs ?? 150_000,
      signal,
    };

    const artDir = join(this.#config.artifactsDir, runId);
    let lease: AccountLease | null = null;
    let session: AppiumSession | null = null;
    let error: string | undefined;
    let crawlReason = 'completed';

    try {
      // Inside the try so that a checkout failure (no free account) still flows
      // to suite_finished/run_finished below — the dashboard never strands.
      lease = this.#registry.checkout(state);
      const manager = target === 'simulator' ? new SimulatorManager() : new PhysicalDeviceManager();
      const device = await manager.acquire(params.preferredUdid);
      session = new AppiumSession(this.#config, manager, device);
      await session.start();
      const driver = session.raw;

      mkdirSync(artDir, { recursive: true });
      const save = async (name: string, base64: string): Promise<string | undefined> => {
        try {
          writeFileSync(join(artDir, name + '.png'), Buffer.from(base64, 'base64'));
          return join(runId, name + '.png'); // relative to artifactsDir, for /artifacts serving
        } catch {
          return undefined;
        }
      };
      const probe = new AppiumProbe(driver, save, this.#config.bundleId, this.#config.explore?.homeControl);

      // If we start on the login screen, capture it as a JUDGED screen (its
      // elements get validated) rather than silently skipping past it.
      const entrySrc = await driver.getPageSource().catch(() => '');
      if (isLoginScreen(entrySrc)) await this.#captureScreen(probe, 'login', onStep);

      if (this.#config.login) {
        const otp = createOtpProvider(this.#config.otp);
        await new LoginHandler(driver, this.#config.login, otp).login(lease.account);
      }
      // Keyboard auto-login (Flutter) to reach the signed-in app — skipped when the
      // run only validates the login flow (explore.loginThenContinue === false).
      const loginThenContinue = this.#config.explore?.loginThenContinue !== false;
      if (this.#config.autoLogin && loginThenContinue) {
        const loginStart = new Date().getTime();
        const res = await autoLogin(driver, this.#config.autoLogin);
        onStep({
          ok: res.loggedIn,
          action: 'login: ' + res.note,
          detail: res.reachedHome ? 'reached home' : undefined,
          error: res.loggedIn ? undefined : 'auto-login did not reach the signed-in app',
          durationMs: new Date().getTime() - loginStart,
        });
      }

      // The dialect/culture popup ("अपनी बोली चुनें") often surfaces a beat AFTER
      // login settles on home, so a single pre-crawl check races it. Poll briefly
      // and dismiss it (Dismiss / आगे बढे) so the crawl starts on real content.
      if (loginThenContinue) {
        for (let i = 0; i < 5; i++) {
          await driver.pause(1000);
          await probe.dismissInterstitials();
          const s = await driver.getPageSource().catch(() => '');
          if (!/अपनी बोली चुनें|बोली चुनें|Choose your dialect/.test(s)) break;
        }
      }

      const outcome = await crawl(probe, opts, onStep);
      crawlReason = outcome.stoppedReason;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      onStep({ ok: false, action: 'exploration aborted', error, durationMs: 0 });
    } finally {
      if (session) await session.stop().catch(() => {});
      if (lease) lease.release();
    }

    // Verdict reflects SCREEN HEALTH (crash / blank / error markers) — the actual
    // sanity signal. A failed `tap:` step is a coverage gap (e.g. a sibling
    // control vanished after navigating away), not an app defect, so it doesn't
    // fail the run; it stays visible per-step for inspection.
    const screens = steps.filter((s) => s.action.startsWith('screen: '));
    const screenIssues = screens.filter((s) => !s.ok).length;
    if (error === undefined && screenIssues > 0) {
      error = screenIssues + ' unhealthy screen(s) of ' + screens.length + ' explored (' + crawlReason + ')';
    }
    const ok = error === undefined && screens.length > 0 && screenIssues === 0;
    const result: SuiteResult = { suite: SUITE, target, state, ok, steps, startedAt, finishedAt: new Date().toISOString(), error };
    observer({ type: 'suite_finished', runId, suite: SUITE, target, result });
    observer({ type: 'run_finished', runId, finishedAt: new Date().toISOString(), total: 1, passed: ok ? 1 : 0, failed: ok ? 0 : 1, ok });
    return result;
  }
}
