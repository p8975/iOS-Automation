import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventHub } from '../src/events/runEvents.ts';
import { RunStore, type StoredRun } from '../src/dashboard/runStore.ts';
import { startDashboard } from '../src/dashboard/server.ts';
import { ingestRun, emitRunEvent, LiveRun } from '../src/dashboard/liveClient.ts';

function harness() {
  const dir = mkdtempSync(join(tmpdir(), 'iss-dash-'));
  const hub = new EventHub();
  const store = new RunStore(dir);
  hub.subscribe(store.handle);
  return { dir, hub, store };
}

test('dashboard serves the page, run history and run detail', async () => {
  const { hub, store, dir } = harness();
  const dash = await startDashboard({ hub, store, port: 0, artifactsDir: dir });
  try {
    const home = await fetch(dash.url + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type') ?? '', /text\/html/);
    await home.text();

    hub.emit({
      type: 'run_started',
      runId: 'd1',
      startedAt: 't0',
      total: 1,
      suites: [{ suite: 'home', state: 'SUBSCRIBED_USER', target: 'simulator' }],
    });
    hub.emit({ type: 'run_finished', runId: 'd1', finishedAt: 't1', total: 1, passed: 1, failed: 0, ok: true });

    const runs = (await (await fetch(dash.url + '/api/runs')).json()) as Array<{ id: string }>;
    assert.equal(Array.isArray(runs), true);
    assert.equal(runs.length, 1);
    assert.equal(runs[0]?.id, 'd1');

    const detail = (await (await fetch(dash.url + '/api/runs/d1')).json()) as { id: string; suites: unknown[] };
    assert.equal(detail.id, 'd1');
    assert.equal(detail.suites.length, 1);

    const missing = await fetch(dash.url + '/api/runs/nope');
    assert.equal(missing.status, 404);
    await missing.text();
  } finally {
    await dash.close();
  }
});

test('SSE endpoint opens with an event-stream content type', async () => {
  const { hub, store, dir } = harness();
  const dash = await startDashboard({ hub, store, port: 0, artifactsDir: dir });
  const ctrl = new AbortController();
  try {
    const res = await fetch(dash.url + '/api/stream', { signal: ctrl.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  } finally {
    ctrl.abort();
    await dash.close();
  }
});

test('POST /api/runs/ingest imports a whole external run (client helper)', async () => {
  const { hub, store, dir } = harness();
  const dash = await startDashboard({ hub, store, port: 0, artifactsDir: dir });
  try {
    const run: StoredRun = {
      id: 'loop-1',
      startedAt: '2026-06-30T00:00:00.000Z',
      finishedAt: '2026-06-30T00:01:00.000Z',
      status: 'failed',
      total: 2,
      passed: 1,
      failed: 1,
      suites: [
        { suite: 'home', state: 'SUBSCRIBED_USER', target: 'device', status: 'failed', steps: [
          { ok: false, action: 'BUG: culture', detail: 'x', durationMs: 0, findings: [{ severity: 'bug', area: 'culture', expected: 'match', actual: 'mismatch' }] },
        ] },
        { suite: 'my-list', state: 'SUBSCRIBED_USER', target: 'device', status: 'passed', steps: [
          { ok: true, action: 'INFO: validated', detail: 'ok', durationMs: 0 },
        ] },
      ],
    };
    const push = await ingestRun(dash.url, run);
    assert.equal(push.ok, true);
    assert.equal(push.runId, 'loop-1');

    const runs = (await (await fetch(dash.url + '/api/runs')).json()) as Array<{ id: string; total: number; failed: number }>;
    assert.equal(runs.some((r) => r.id === 'loop-1'), true);

    const detail = (await (await fetch(dash.url + '/api/runs/loop-1')).json()) as StoredRun;
    assert.equal(detail.total, 2);
    assert.equal(detail.suites.length, 2);
    assert.equal(detail.suites[0]?.steps[0]?.findings?.[0]?.severity, 'bug');
  } finally {
    await dash.close();
  }
});

test('POST /api/runs/event streams events into the store (LiveRun client)', async () => {
  const { hub, store, dir } = harness();
  const dash = await startDashboard({ hub, store, port: 0, artifactsDir: dir });
  try {
    const live = new LiveRun(dash.url, 'stream-1');
    const ref = { suite: 'search', state: 'SUBSCRIBED_USER', target: 'device' } as const;
    await live.start([ref]);
    await live.suiteStart(ref);
    await live.step(ref, { ok: false, action: 'BUG: no-results copy', durationMs: 0 });
    await live.suiteFinish({ suite: 'search', target: 'device', state: 'SUBSCRIBED_USER', ok: false, steps: [
      { ok: false, action: 'BUG: no-results copy', durationMs: 0 },
    ], startedAt: 't0', finishedAt: 't1' });
    await live.finish([{ suite: 'search', target: 'device', state: 'SUBSCRIBED_USER', ok: false, steps: [], startedAt: 't0', finishedAt: 't1' }]);

    const detail = (await (await fetch(dash.url + '/api/runs/stream-1')).json()) as StoredRun;
    assert.equal(detail.id, 'stream-1');
    assert.equal(detail.status, 'failed');
    assert.equal(detail.suites[0]?.status, 'failed');
    assert.equal(detail.suites[0]?.steps.length, 1);
  } finally {
    await dash.close();
  }
});

test('live wire-up rejects malformed events and runs', async () => {
  const { hub, store, dir } = harness();
  const dash = await startDashboard({ hub, store, port: 0, artifactsDir: dir });
  try {
    const badEvent = await emitRunEvent(dash.url, { type: 'not_a_type', runId: 'x' } as unknown as never);
    assert.equal(badEvent.ok, false);
    assert.equal(badEvent.status, 400);

    const badRun = await fetch(dash.url + '/api/runs/ingest', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nope: true }),
    });
    assert.equal(badRun.status, 400);
    await badRun.text();
  } finally {
    await dash.close();
  }
});

test('path traversal on /artifacts is rejected', async () => {
  const { hub, store, dir } = harness();
  const dash = await startDashboard({ hub, store, port: 0, artifactsDir: dir });
  try {
    const res = await fetch(dash.url + '/artifacts/..%2f..%2f..%2fetc%2fpasswd');
    assert.ok(res.status === 403 || res.status === 404);
    await res.text();
  } finally {
    await dash.close();
  }
});
