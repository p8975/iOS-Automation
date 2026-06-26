import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadRunnerConfig } from '../src/config/config.ts';

function writeConfig(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cfg-'));
  const path = join(dir, 'runner.config.yaml');
  writeFileSync(path, body);
  return path;
}

test('missing config file falls back to defaults', () => {
  const cfg = loadRunnerConfig('/does/not/exist.yaml');
  assert.equal(cfg.otp.defaultStrategy, 'bypass');
  assert.equal(cfg.defaultTarget, 'any');
  assert.equal(cfg.appium.port, 4723);
});

test('maps snake_case OTP config into the typed shape', () => {
  const path = writeConfig(`
bundleId: in.stage.app
defaultTarget: device
otp:
  default_strategy: backend_endpoint
  backend_endpoint:
    url: https://qa/otp
`);
  const cfg = loadRunnerConfig(path);
  assert.equal(cfg.bundleId, 'in.stage.app');
  assert.equal(cfg.defaultTarget, 'device');
  assert.equal(cfg.otp.defaultStrategy, 'backend_endpoint');
  assert.equal(cfg.otp.backendEndpoint?.url, 'https://qa/otp');
});

test('appium overrides layer over defaults', () => {
  const path = writeConfig(`
appium:
  port: 4799
`);
  const cfg = loadRunnerConfig(path);
  assert.equal(cfg.appium.port, 4799);
  assert.equal(cfg.appium.hostname, '127.0.0.1'); // default preserved
});
