#!/usr/bin/env node
/**
 * CLI entrypoint. Thin wrapper over the module API.
 *
 *   ios-sanity --suite suites/home_entitlement_sanity.yaml --target device
 *   ios-sanity --all --target device
 *   ios-sanity --all --dashboard            # live dashboard at http://localhost:4500
 *   ios-sanity --dashboard                  # dashboard only: browse history + Explore button
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadRunnerConfig } from './config/config.ts';
import { AccountRegistry } from './registry/accountRegistry.ts';
import { FileLockLeaseStore } from './registry/leaseStore.ts';
import { loadSuiteFile, loadSuiteDir } from './suite/loader.ts';
import { RunController } from './engine/runController.ts';
import { Reporter } from './reporter/reporter.ts';
import { isUserState, USER_STATES, type SuiteResult, type Target, type UserState } from './types.ts';
import { EventHub, newRunId, runStartedEvent, runFinishedEvent, type RunObserver } from './events/runEvents.ts';
import { RunStore } from './dashboard/runStore.ts';
import {
  startDashboard,
  type DashboardHandle,
  type TriggerRequest,
  type TriggerResult,
} from './dashboard/server.ts';
import { Explorer } from './explore/explorer.ts';

interface Args {
  suite?: string;
  all?: boolean;
  target?: Target;
  udid?: string;
  parallel: number;
  lockDir?: string;
  config: string;
  accounts: string;
  suitesDir: string;
  dashboard?: boolean;
  dashboardPort: number;
}

const DEFAULT_EXPLORE_STATE: UserState = 'SUBSCRIBED_USER';

function parseArgs(argv: string[]): Args {
  const a: Args = {
    parallel: 1,
    config: 'config/runner.config.yaml',
    accounts: 'config/accounts.yaml',
    suitesDir: 'suites',
    dashboardPort: 4500,
  };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i + 1];
    switch (argv[i]) {
      case '--suite': a.suite = v; i++; break;
      case '--all': a.all = true; break;
      case '--target': a.target = v as Target; i++; break;
      case '--udid': a.udid = v; i++; break;
      case '--parallel': a.parallel = Math.max(1, Number(v) || 1); i++; break;
      case '--lock-dir': a.lockDir = v; i++; break;
      case '--config': a.config = v!; i++; break;
      case '--accounts': a.accounts = v!; i++; break;
      case '--suites': a.suitesDir = v!; i++; break;
      case '--dashboard': a.dashboard = true; break;
      case '--dashboard-port': a.dashboardPort = Math.max(1, Number(v) || 4500); i++; break;
    }
  }
  return a;
}

function waitForSigint(): Promise<void> {
  return new Promise<void>((res) => {
    process.once('SIGINT', () => {
      console.log('\n↩ shutting down dashboard…');
      res();
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadRunnerConfig(resolve(args.config));

  // Build the registry/controller once (used by both suite runs and the
  // dashboard's Explore trigger). Without an accounts file we can still serve
  // the dashboard read-only — the trigger button is simply disabled.
  const accountsExist = existsSync(args.accounts);
  let controller: RunController | undefined;
  let registry: AccountRegistry | undefined;
  if (accountsExist) {
    const leases = args.lockDir ? new FileLockLeaseStore(resolve(args.lockDir)) : undefined;
    registry = AccountRegistry.fromFile(resolve(args.accounts), leases);
    controller = new RunController(config, registry);
  }

  // Shared run-in-progress guard: blocks a UI-triggered crawl while any run
  // (CLI suite run or another crawl) is using the single device.
  let busy = false;
  let aborter: AbortController | null = null;

  let hub: EventHub | undefined;
  let dash: DashboardHandle | undefined;
  if (args.dashboard) {
    hub = new EventHub();
    const store = new RunStore(config.artifactsDir);
    hub.subscribe(store.handle);
    const liveHub = hub;

    const onTrigger = registry
      ? async (req: TriggerRequest): Promise<TriggerResult> => {
          if (busy) return { ok: false, busy: true, error: 'a run is already in progress' };
          const state = req.state && isUserState(req.state) ? req.state : DEFAULT_EXPLORE_STATE;
          const target: Target = req.target === 'simulator' || req.target === 'device' || req.target === 'any'
            ? req.target
            : config.defaultTarget;
          busy = true;
          aborter = new AbortController();
          const runId = newRunId();
          const signal = aborter.signal;
          void new Explorer(config, registry!)
            .run({ runId, state, target, observer: (e) => liveHub.emit(e), signal })
            .catch((err) => console.error('exploration error:', err))
            .finally(() => {
              busy = false;
              aborter = null;
            });
          return { ok: true, runId };
        }
      : undefined;

    const onStop = (): boolean => {
      if (aborter) {
        aborter.abort();
        return true;
      }
      return false;
    };

    try {
      dash = await startDashboard({
        hub,
        store,
        port: args.dashboardPort,
        artifactsDir: config.artifactsDir,
        onTrigger,
        onStop,
        capabilities: {
          trigger: Boolean(registry),
          states: [...USER_STATES],
          targets: ['simulator', 'device', 'any'],
          defaultState: DEFAULT_EXPLORE_STATE,
          defaultTarget: config.defaultTarget,
        },
      });
      console.log(`📊 Dashboard live at ${dash.url}`);
      if (!registry) console.log('   (Explore disabled — add config/accounts.yaml to enable triggering runs.)');
    } catch (err) {
      console.warn(`⚠ dashboard failed to start (${(err as Error).message}) — continuing without it.`);
      hub = undefined;
    }
  }

  const suites = args.all
    ? loadSuiteDir(resolve(args.suitesDir))
    : args.suite
      ? [loadSuiteFile(resolve(args.suite))]
      : [];

  if (suites.length === 0) {
    if (dash) {
      console.log('No suite specified — dashboard is serving history and the Explore button. Press Ctrl-C to exit.');
      await waitForSigint();
      await dash.close();
      return;
    }
    console.error('✖ nothing to run — pass --suite <file> or --all');
    process.exitCode = 2;
    return;
  }

  if (!accountsExist || !controller) {
    console.error(`✖ account registry not found: ${args.accounts}\n  copy config/accounts.example.yaml → ${args.accounts} and fill it in.`);
    process.exitCode = 2;
    if (dash) await dash.close();
    return;
  }

  if (!config.stateBackend?.statusUrl) {
    console.warn('⚠ no stateBackend.statusUrl configured — DRIFT CHECK is skipped (using declared state).');
  }

  const runnable = suites.filter((s) => {
    if (isUserState(s.requires)) return true;
    console.error(`✖ suite "${s.suite}" requires unknown state ${s.requires} — skipped`);
    return false;
  });

  const items = runnable.map((suite) => ({
    suite,
    opts: { target: args.target, preferredUdid: args.udid },
  }));

  const observer: RunObserver | undefined = hub ? (e) => hub!.emit(e) : undefined;

  busy = true; // block UI-triggered crawls while this CLI run uses the device
  let results: SuiteResult[];
  try {
    if (args.parallel > 1) {
      console.log(`▶ running ${items.length} suite(s) with concurrency ${args.parallel}…`);
      results = await controller.runSuites(items, args.parallel, observer);
      for (const r of results) console.log(`  ${r.ok ? '✅ PASS' : '❌ FAIL'} ${r.suite}${r.ok ? '' : ` — ${r.error ?? 'see steps'}`}`);
    } else {
      const runId = newRunId();
      observer?.(runStartedEvent(runId, new Date().toISOString(), controller.previewTargets(items)));
      results = [];
      for (const item of items) {
        process.stdout.write(`▶ ${item.suite.suite} (requires ${item.suite.requires}) … `);
        const result = await controller.runSuite(item.suite, item.opts, observer, runId);
        results.push(result);
        console.log(result.ok ? '✅ PASS' : `❌ FAIL — ${result.error ?? 'see steps'}`);
      }
      observer?.(runFinishedEvent(runId, new Date().toISOString(), results));
    }
  } finally {
    busy = false;
  }

  const { junitPath, htmlPath } = new Reporter(config.artifactsDir).write(results);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed · ${junitPath} · ${htmlPath}`);
  process.exitCode = passed === results.length ? 0 : 1;

  if (dash) {
    console.log(`\n📊 Dashboard still live at ${dash.url} — press Ctrl-C to exit.`);
    await waitForSigint();
    await dash.close();
  }
}

main().catch((err) => {
  console.error('runner crashed:', err);
  process.exitCode = 2;
});
