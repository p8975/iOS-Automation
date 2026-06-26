import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalBuildProvider } from '../src/build/localProvider.ts';
import { DeviceExtractProvider } from '../src/build/deviceExtractProvider.ts';
import { kindForPath } from '../src/build/buildProvider.ts';

function fixtures() {
  const dir = mkdtempSync(join(tmpdir(), 'build-'));
  const ipa = join(dir, 'app.ipa');
  const app = join(dir, 'App.app');
  writeFileSync(ipa, 'fake');
  mkdirSync(app);
  return { ipa, app };
}

test('kindForPath maps extensions and rejects unknown', () => {
  assert.equal(kindForPath('/x/App.app'), 'app');
  assert.equal(kindForPath('/x/app.ipa'), 'ipa');
  assert.throws(() => kindForPath('/x/app.zip'));
});

test('device target resolves the .ipa', async () => {
  const { ipa, app } = fixtures();
  const p = new LocalBuildProvider({ appPath: app, ipaPath: ipa });
  assert.deepEqual(await p.resolve('device'), { path: ipa, kind: 'ipa' });
});

test('simulator target resolves the .app', async () => {
  const { ipa, app } = fixtures();
  const p = new LocalBuildProvider({ appPath: app, ipaPath: ipa });
  assert.deepEqual(await p.resolve('simulator'), { path: app, kind: 'app' });
});

test('simulator target with only an .ipa is rejected (slice rule)', async () => {
  const { ipa } = fixtures();
  const p = new LocalBuildProvider({ ipaPath: ipa });
  await assert.rejects(() => p.resolve('simulator'));
});

test('a .ipa supplied as appPath is rejected (slice mismatch)', async () => {
  const { ipa } = fixtures();
  const p = new LocalBuildProvider({ appPath: ipa });
  await assert.rejects(() => p.resolve('simulator'));
});

test('a missing build path is rejected', async () => {
  const p = new LocalBuildProvider({ ipaPath: '/nope/missing.ipa' });
  await assert.rejects(() => p.resolve('device'));
});

test('device-extract refuses a simulator target (device-signed output)', async () => {
  const p = new DeviceExtractProvider({ udid: 'x', bundleId: 'in.stage.app', outDir: '/tmp' });
  await assert.rejects(() => p.resolve('simulator'));
});
