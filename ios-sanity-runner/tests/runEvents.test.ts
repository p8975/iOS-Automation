import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventHub, newRunId, runStartedEvent, runFinishedEvent } from '../src/events/runEvents.ts';
import type { SuiteResult } from '../src/types.ts';

test('EventHub fans out to subscribers and stops after unsubscribe', () => {
  const hub = new EventHub();
  const seen: string[] = [];
  const unsub = hub.subscribe((e) => seen.push(e.type));
  hub.emit({ type: 'run_finished', runId: 'r', finishedAt: 'now', total: 0, passed: 0, failed: 0, ok: true });
  assert.deepEqual(seen, ['run_finished']);
  unsub();
  hub.emit({ type: 'run_finished', runId: 'r', finishedAt: 'now', total: 0, passed: 0, failed: 0, ok: true });
  assert.deepEqual(seen, ['run_finished']);
  assert.equal(hub.size, 0);
});

test('a throwing observer never starves the others or breaks emit', () => {
  const hub = new EventHub();
  let reached = false;
  hub.subscribe(() => {
    throw new Error('boom');
  });
  hub.subscribe(() => {
    reached = true;
  });
  hub.emit({ type: 'run_finished', runId: 'r', finishedAt: 'n', total: 0, passed: 0, failed: 0, ok: true });
  assert.equal(reached, true);
});

test('runFinishedEvent derives passed/failed/ok from results', () => {
  const results: SuiteResult[] = [
    { suite: 'a', target: 'simulator', state: 'SUBSCRIBED_USER', ok: true, steps: [], startedAt: 's', finishedAt: 'f' },
    { suite: 'b', target: 'simulator', state: 'SUBSCRIBED_USER', ok: false, steps: [], startedAt: 's', finishedAt: 'f' },
  ];
  const e = runFinishedEvent('r', 'now', results);
  assert.equal(e.type, 'run_finished');
  if (e.type === 'run_finished') {
    assert.equal(e.total, 2);
    assert.equal(e.passed, 1);
    assert.equal(e.failed, 1);
    assert.equal(e.ok, false);
  }
});

test('runStartedEvent carries the resolved suite list', () => {
  const e = runStartedEvent('r', 'now', [{ suite: 'a', state: 'SUBSCRIBED_USER', target: 'device' }]);
  assert.equal(e.type, 'run_started');
  if (e.type === 'run_started') {
    assert.equal(e.total, 1);
    assert.equal(e.suites[0]?.suite, 'a');
  }
});

test('newRunId is unique per call and filesystem-safe', () => {
  const a = newRunId();
  const b = newRunId();
  assert.notEqual(a, b);
  assert.match(a, /^[a-zA-Z0-9._-]+$/);
});
