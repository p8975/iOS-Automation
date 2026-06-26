#!/usr/bin/env node
/**
 * Environment preflight. Answers one question: "can this machine actually
 * drive an iOS sanity run right now, and if not, exactly what's missing?"
 *
 * Run: npm run doctor
 */
import { run, which } from '../src/devices/exec.ts';

type Status = 'ok' | 'warn' | 'fail';
interface Check {
  label: string;
  status: Status;
  detail: string;
}

const ICON: Record<Status, string> = { ok: '✅', warn: '⚠️ ', fail: '❌' };

async function main(): Promise<void> {
  const checks: Check[] = [];
  const add = (label: string, status: Status, detail: string) => checks.push({ label, status, detail });

  // Node
  const major = Number(process.versions.node.split('.')[0]);
  add('Node >= 22', major >= 22 ? 'ok' : 'fail', `found v${process.versions.node}`);

  // Full Xcode vs Command Line Tools — the critical gate for XCUITest/WDA.
  const xsel = await run('xcode-select', ['-p']);
  const path = xsel.stdout.trim();
  const hasFullXcode = path.includes('Xcode.app');
  add(
    'Full Xcode (required to drive UI)',
    hasFullXcode ? 'ok' : 'fail',
    hasFullXcode
      ? path
      : `xcode-select points at "${path}". Only Command Line Tools are active. ` +
        `XCUITest/WebDriverAgent cannot build → no UI automation on sim OR device.`,
  );

  // `which xcodebuild` finds the CLT shim even without Xcode, so test that it
  // actually runs (it errors out under Command Line Tools only).
  const xcodebuild = await run('xcodebuild', ['-version']);
  add(
    'xcodebuild functional',
    xcodebuild.ok ? 'ok' : 'fail',
    xcodebuild.ok
      ? (xcodebuild.stdout.split('\n')[0] ?? 'ok')
      : 'present as a shim but non-functional (needs full Xcode)',
  );

  // simctl (Simulator support)
  const simctl = await run('xcrun', ['simctl', 'help']);
  add('simctl (Simulator)', simctl.ok ? 'ok' : 'fail', simctl.ok ? '' : 'unavailable without full Xcode');

  // Appium + xcuitest driver
  const appium = await run('appium', ['--version']);
  add('Appium server', appium.ok ? 'ok' : 'fail', appium.ok ? `v${appium.stdout.trim()}` : 'not installed');

  const drivers = await run('appium', ['driver', 'list', '--installed']);
  const hasXcuitest = /xcuitest/i.test(drivers.stdout + drivers.stderr);
  add(
    'Appium xcuitest driver',
    hasXcuitest ? 'ok' : 'fail',
    hasXcuitest ? '' : 'missing → run `appium driver install xcuitest`',
  );

  // libimobiledevice (device discovery + install — works without Xcode)
  const hasIdeviceId = await which('idevice_id');
  add(
    'libimobiledevice',
    hasIdeviceId ? 'ok' : 'warn',
    hasIdeviceId ? '' : 'install via `brew install libimobiledevice ideviceinstaller` for device install',
  );

  // Connected physical devices
  if (hasIdeviceId) {
    const ids = await run('idevice_id', ['-l']);
    const udids = ids.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    if (udids.length === 0) {
      add('Connected device', 'warn', 'none detected (connect + trust a device, or use a simulator)');
    } else {
      for (const udid of udids) {
        const info = await run('ideviceinfo', ['-u', udid, '-s']);
        const name = (info.stdout.match(/DeviceName: (.*)/)?.[1] ?? 'iPhone').trim();
        const ver = (info.stdout.match(/ProductVersion: (.*)/)?.[1] ?? '?').trim();
        const model = (info.stdout.match(/ProductType: (.*)/)?.[1] ?? '?').trim();
        add(`Device: ${name}`, 'ok', `${model}, iOS ${ver}, udid ${udid}`);
      }
    }
  }

  // Report
  console.log('\niOS Sanity Runner — environment doctor\n' + '='.repeat(42));
  for (const c of checks) {
    console.log(`${ICON[c.status]} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  }

  const fails = checks.filter((c) => c.status === 'fail');
  console.log('\n' + '='.repeat(42));
  if (fails.length === 0) {
    console.log('READY: this machine can run iOS sanity tests.');
  } else {
    console.log(`NOT READY: ${fails.length} blocking item(s). Resolve the ❌ rows above.`);
    console.log('\nMost likely fix for this machine:');
    console.log('  1. Install full Xcode from the App Store (or developer.apple.com).');
    console.log('  2. sudo xcode-select -s /Applications/Xcode.app/Contents/Developer');
    console.log('  3. sudo xcodebuild -license accept && xcodebuild -runFirstLaunch');
    console.log('  4. appium driver install xcuitest');
  }
  process.exitCode = fails.length === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('doctor crashed:', err);
  process.exitCode = 2;
});
