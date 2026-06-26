import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../src/engine/concurrency.ts';

test('never exceeds the concurrency limit and preserves order', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (n) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 10;
  });
  assert.ok(peak <= 2, `peak ${peak} exceeded limit`);
  assert.deepEqual(
    out.map((r) => (r.status === 'fulfilled' ? r.value : null)),
    [10, 20, 30, 40, 50, 60],
  );
});

test('a rejected item is isolated, not fatal to the batch', async () => {
  const out = await mapWithConcurrency([1, 2, 3], 3, async (n) => {
    if (n === 2) throw new Error('boom');
    return n;
  });
  assert.equal(out[0]?.status, 'fulfilled');
  assert.equal(out[1]?.status, 'rejected');
  assert.equal(out[2]?.status, 'fulfilled');
});
