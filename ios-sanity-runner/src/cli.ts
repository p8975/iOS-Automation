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
import { loadSuiteFile, loadSuiteDir } from './suite/loader.ts';
import { RunController } from './engine/runController.ts';
import { Reporter } from './reporter/reporter.ts';
import { isUserState, type SuiteResult, type Target } from './types.ts';

interface Args {
  suite?: string;
  all?: boolean;
  target?: Target;
  udid?: string;
  config: string;
  accounts: string;
  suitesDir: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
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
  const registry = AccountRegistry.fromFile(resolve(args.accounts));
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

  const results: SuiteResult[] = [];
  for (const suite of suites) {
    if (!isUserState(suite.requires)) {
      console.error(`✖ suite "${suite.suite}" requires unknown state ${suite.requires}`);
      continue;
    }
    process.stdout.write(`▶ ${suite.suite} (requires ${suite.requires}) … `);
    const result = await controller.runSuite(suite, { target: args.target, preferredUdid: args.udid });
    results.push(result);
    console.log(result.ok ? '✅ PASS' : `❌ FAIL — ${result.error ?? 'see steps'}`);
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
