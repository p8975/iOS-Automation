import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryLeaseStore, FileLockLeaseStore } from '../src/registry/leaseStore.ts';
import { AccountRegistry } from '../src/registry/accountRegistry.ts';

test('in-memory store prevents double-acquire and frees on release', () => {
  const s = new InMemoryLeaseStore();
  assert.equal(s.tryAcquire('+1'), true);
  assert.equal(s.tryAcquire('+1'), false);
  s.release('+1');
  assert.equal(s.tryAcquire('+1'), true);
});

test('file-lock store is exclusive ACROSS separate store instances (processes)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lease-'));
  const a = new FileLockLeaseStore(dir);
  const b = new FileLockLeaseStore(dir); // simulates a second runner process
  assert.equal(a.tryAcquire('+91999'), true);
  assert.equal(b.tryAcquire('+91999'), false); // b sees a's lock on disk
  assert.deepEqual(a.activeLeases(), ['+91999']);
  a.release('+91999');
  assert.equal(b.tryAcquire('+91999'), true);
});

test('registry leasing is collision-safe across two registries sharing a lock dir', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lease-reg-'));
  const fixture = { accounts: { SUBSCRIBED_USER: [{ phone: '+1' }] } };
  const r1 = AccountRegistry.fromObject(fixture, new FileLockLeaseStore(dir));
  const r2 = AccountRegistry.fromObject(fixture, new FileLockLeaseStore(dir));
  r1.checkout('SUBSCRIBED_USER');
  assert.throws(() => r2.checkout('SUBSCRIBED_USER')); // pool exhausted via shared lock
});
