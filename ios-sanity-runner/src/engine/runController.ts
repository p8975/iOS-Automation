import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunnerConfig } from '../config/config.ts';
import type { SuiteDefinition } from '../suite/schema.ts';
import type { DeviceManager } from '../devices/deviceManager.ts';
import type { BuildProvider } from '../build/buildProvider.ts';
import { SimulatorManager } from '../devices/simulator.ts';
import { PhysicalDeviceManager } from '../devices/physicalDevice.ts';
import { AccountRegistry } from '../registry/accountRegistry.ts';
import { createOtpProvider } from '../otp/index.ts';
import { AppiumSession } from '../session/appiumSession.ts';
import { LoginHandler } from '../login/loginHandler.ts';
import { ActionRunner } from '../actions/actionRunner.ts';
import { BackendStateDetector, assertState } from '../state/stateDetector.ts';
import { mapWithConcurrency } from './concurrency.ts';
import {
  type SuiteResult,
  type StepResult,
  type Target,
  type UserState,
  type Account,
  RunnerError,
} from '../types.ts';

export interface RunOptions {
  target?: Target;
  preferredUdid?: string;
  /** Install this build before running; omit to attach to the installed app. */
  build?: BuildProvider;
}

/** Orchestrates one suite end-to-end against one target. */
export class RunController {
  private readonly config: RunnerConfig;
  private readonly registry: AccountRegistry;

  constructor(config: RunnerConfig, registry: AccountRegistry) {
    this.config = config;
    this.registry = registry;
  }

  private managerFor(target: Target): DeviceManager {
    return target === 'simulator' ? new SimulatorManager() : new PhysicalDeviceManager();
  }

  private resolveTarget(suite: SuiteDefinition, opts: RunOptions): Target {
    const requested = opts.target ?? suite.target ?? this.config.defaultTarget;
    if (requested === 'any') return this.config.defaultTarget === 'any' ? 'device' : this.config.defaultTarget;
    return requested;
  }

  /**
   * Run many suites with bounded concurrency. Account leasing is collision-safe
   * via the registry's LeaseStore; to parallelize across real devices, give each
   * run a distinct `preferredUdid` (or keep concurrency at 1 for a single
   * device). A thrown run becomes a failed SuiteResult — one bad suite never
   * aborts the batch.
   */
  async runSuites(
    items: ReadonlyArray<{ suite: SuiteDefinition; opts?: RunOptions }>,
    concurrency = 1,
  ): Promise<SuiteResult[]> {
    const settled = await mapWithConcurrency(items, concurrency, (it) => this.runSuite(it.suite, it.opts));
    return settled.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const item = items[i]!;
      const now = new Date().toISOString();
      return {
        suite: item.suite.suite,
        target: this.resolveTarget(item.suite, item.opts ?? {}),
        state: item.suite.requires,
        ok: false,
        steps: [],
        startedAt: now,
        finishedAt: now,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });
  }

  async runSuite(suite: SuiteDefinition, opts: RunOptions = {}): Promise<SuiteResult> {
    const startedAt = new Date().toISOString();
    const target = this.resolveTarget(suite, opts);
    const declared = suite.requires;
    const steps: StepResult[] = [];
    const lease = this.registry.checkout(declared);
    let session: AppiumSession | null = null;

    try {
      const manager = this.managerFor(target);
      const device = await manager.acquire(opts.preferredUdid);

      if (opts.build) {
        const artifact = await opts.build.resolve(target);
        await manager.install(device, artifact.path);
      }

      session = new AppiumSession(this.config, manager, device);
      await session.start();
      const driver = session.raw;

      // --- setup: login + drift check ---
      const detectedState = await this.runSetup(suite, driver, lease.account, declared);

      // --- main steps (state-aware branching uses detectedState) ---
      const runner = new ActionRunner(driver, {
        detectedState,
        flows: (suite.flows ?? {}) as Record<string, unknown[]>,
        matrices: (suite.matrices ?? {}) as Record<string, Record<string, { visible?: string[]; absent?: string[] }>>,
        defaultTimeoutMs: 15_000,
      });
      steps.push(...(await runner.runSteps(suite.steps as unknown[])));

      // --- teardown ---
      if (suite.teardown.length > 0) {
        steps.push(...(await runner.runSteps(suite.teardown as unknown[])));
      }

      const ok = steps.every((s) => s.ok);
      const result: SuiteResult = {
        suite: suite.suite,
        target,
        state: declared,
        ok,
        steps,
        startedAt,
        finishedAt: new Date().toISOString(),
      };
      await this.captureFailureArtifact(session, suite, ok);
      return result;
    } catch (err) {
      if (session) await this.captureFailureArtifact(session, suite, false);
      return {
        suite: suite.suite,
        target,
        state: declared,
        ok: false,
        steps,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (session) await session.stop().catch(() => {});
      lease.release();
    }
  }

  /** Runs login + drift check; returns the state to branch on at runtime. */
  private async runSetup(
    suite: SuiteDefinition,
    driver: WebdriverIO.Browser,
    account: Account,
    declared: UserState,
  ): Promise<UserState> {
    let detectedState: UserState = declared;
    const detector = this.config.stateBackend?.statusUrl ? new BackendStateDetector(this.config) : null;

    for (const step of suite.setup) {
      if ('login' in step) {
        if (!this.config.login) {
          throw new RunnerError('suite requires login but no `login` locators in runner config');
        }
        const otp = createOtpProvider(this.config.otp);
        const handler = new LoginHandler(driver, this.config.login, otp);
        await handler.login(account);
      } else if ('assert_state' in step) {
        if (detector) {
          // DRIFT CHECK: declared state must equal the real backend state.
          detectedState = await assertState(detector, account, step.assert_state);
        }
        // Without a backend detector we keep declared state and skip drift (logged by CLI).
      }
    }
    return detectedState;
  }

  /** On failure, dump page source + screenshot for debugging. */
  private async captureFailureArtifact(session: AppiumSession, suite: SuiteDefinition, ok: boolean): Promise<void> {
    if (ok) return;
    try {
      const dir = join(this.config.artifactsDir, suite.suite);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'page-source.xml'), await session.pageSource(), 'utf8');
      writeFileSync(join(dir, 'screenshot.png'), Buffer.from(await session.screenshot(), 'base64'));
    } catch {
      /* best-effort */
    }
  }
}
