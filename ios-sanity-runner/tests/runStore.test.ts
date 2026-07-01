import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RunStore } from '../src/dashboard/runStore.ts';
import type { SuiteResult } from '../src/types.ts';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'iss-store-'));
}

test('store tracks a run start→step→suite→finish and persists it', () => {
  const dir = tmpDir();
  const store = new RunStore(dir);
  const runId = 'run-1';

  store.handle({
    type: 'run_started',
    runId,
    startedAt: 't0',
    total: 1,
    suites: [{ suite: 'home', state: 'SUBSCRIBED_USER', target: 'simulator' }],
  });
  assert.equal(store.current()?.status, 'running');
  assert.equal(store.current()?.suites[0]?.status, 'pending');

  store.handle({ type: 'suite_started', runId, suite: 'home', target: 'simulator', state: 'SUBSCRIBED_USER', startedAt: 't1' });
  assert.equal(store.current()?.suites[0]?.status, 'running');

  store.handle({ type: 'step_finished', runId, suite: 'home', target: 'simulator', index: 0, step: { ok: true, action: 'tap', durationMs: 5 } });
  assert.equal(store.current()?.suites[0]?.steps[0]?.action, 'tap');

  const result: SuiteResult = {
    suite: 'home',
    target: 'simulator',
    state: 'SUBSCRIBED_USER',
    ok: true,
    steps: [{ ok: true, action: 'tap', durationMs: 5 }],
    startedAt: 't1',
    finishedAt: 't2',
  };
  store.handle({ type: 'suite_finished', runId, suite: 'home', target: 'simulator', result });
  assert.equal(store.current()?.suites[0]?.status, 'passed');
  assert.equal(store.current()?.passed, 1);

  store.handle({ type: 'run_finished', runId, finishedAt: 't3', total: 1, passed: 1, failed: 0, ok: true });
  assert.equal(store.current()?.status, 'passed');

  const file = join(dir, 'runs', 'run-1', 'run.json');
  assert.ok(existsSync(file));
  const onDisk = JSON.parse(readFileSync(file, 'utf8')) as { status: string };
  assert.equal(onDisk.status, 'passed');

  assert.equal(store.listRuns().length, 1);
  assert.equal(store.getRun('run-1')?.id, 'run-1');
  assert.equal(store.getRun('missing'), null);
});

test('a failed suite is reflected in status, counts and error', () => {
  const store = new RunStore(tmpDir());
  store.handle({
    type: 'run_started',
    runId: 'r2',
    startedAt: 't0',
    total: 1,
    suites: [{ suite: 'x', state: 'IN_TRIAL_USER', target: 'device' }],
  });
  const result: SuiteResult = {
    suite: 'x',
    target: 'device',
    state: 'IN_TRIAL_USER',
    ok: false,
    steps: [{ ok: false, action: 'assert_visible', durationMs: 9, error: 'not found' }],
    startedAt: 'a',
    finishedAt: 'b',
    error: 'boom',
  };
  store.handle({ type: 'suite_finished', runId: 'r2', suite: 'x', target: 'device', result });
  const cur = store.current();
  assert.equal(cur?.suites[0]?.status, 'failed');
  assert.equal(cur?.failed, 1);
  assert.equal(cur?.suites[0]?.error, 'boom');
});

test('events for an unknown run id are ignored, not thrown', () => {
  const store = new RunStore(tmpDir());
  assert.doesNotThrow(() =>
    store.handle({ type: 'suite_started', runId: 'ghost', suite: 's', target: 'device', state: 'PAUSED_USER', startedAt: 't' }),
  );
  assert.equal(store.current(), null);
});
