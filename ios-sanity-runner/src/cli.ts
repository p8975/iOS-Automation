#!/usr/bin/env node
/**
 * CLI entrypoint. Thin wrapper over the module API.
 *
 *   ios-sanity --suite suites/home_entitlement_sanity.yaml --target device
 *   ios-sanity --all --target device
 */
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadRunnerConfig } from './config/config.ts';
import { AccountRegistry } from './registry/accountRegistry.ts';
import { FileLockLeaseStore } from './registry/leaseStore.ts';
import { loadSuiteFile, loadSuiteDir } from './suite/loader.ts';
import { RunController } from './engine/runController.ts';
import { Reporter } from './reporter/reporter.ts';
import { isUserState, type SuiteResult, type Target } from './types.ts';

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
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    parallel: 1,
    config: 'config/runner.config.yaml',
    accounts: 'config/accounts.yaml',
    suitesDir: 'suites',
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
    }
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!existsSync(args.accounts)) {
    console.error(`✖ account registry not found: ${args.accounts}\n  copy config/accounts.example.yaml → ${args.accounts} and fill it in.`);
    process.exitCode = 2;
    return;
  }

  const config = loadRunnerConfig(resolve(args.config));
  // A lock dir makes account leasing collision-safe across runner processes
  // (parallel CI shards / a device farm). Default in-memory is fine otherwise.
  const leases = args.lockDir ? new FileLockLeaseStore(resolve(args.lockDir)) : undefined;
  const registry = AccountRegistry.fromFile(resolve(args.accounts), leases);
  const controller = new RunController(config, registry);

  const suites = args.all
    ? loadSuiteDir(resolve(args.suitesDir))
    : args.suite
      ? [loadSuiteFile(resolve(args.suite))]
      : [];
  if (suites.length === 0) {
    console.error('✖ nothing to run — pass --suite <file> or --all');
    process.exitCode = 2;
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

  let results: SuiteResult[];
  if (args.parallel > 1) {
    console.log(`▶ running ${items.length} suite(s) with concurrency ${args.parallel}…`);
    results = await controller.runSuites(items, args.parallel);
    for (const r of results) console.log(`  ${r.ok ? '✅ PASS' : '❌ FAIL'} ${r.suite}${r.ok ? '' : ` — ${r.error ?? 'see steps'}`}`);
  } else {
    results = [];
    for (const item of items) {
      process.stdout.write(`▶ ${item.suite.suite} (requires ${item.suite.requires}) … `);
      const result = await controller.runSuite(item.suite, item.opts);
      results.push(result);
      console.log(result.ok ? '✅ PASS' : `❌ FAIL — ${result.error ?? 'see steps'}`);
    }
  }

  const { junitPath, htmlPath } = new Reporter(config.artifactsDir).write(results);
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed · ${junitPath} · ${htmlPath}`);
  process.exitCode = passed === results.length ? 0 : 1;
}

main().catch((err) => {
  console.error('runner crashed:', err);
  process.exitCode = 2;
});
