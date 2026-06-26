import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AccountRegistry } from '../src/registry/accountRegistry.ts';
import { NoAvailableAccountError } from '../src/types.ts';

const fixture = {
  accounts: {
    SUBSCRIBED_USER: [{ phone: '+911', notes: 'a' }, { phone: '+912' }],
    IN_TRIAL_USER: [{ phone: '+913', bypass_code: '4242' }],
  },
};

test('resolves an account by state name', () => {
  const reg = AccountRegistry.fromObject(fixture);
  const lease = reg.checkout('SUBSCRIBED_USER');
  assert.equal(lease.account.state, 'SUBSCRIBED_USER');
  assert.equal(lease.account.phone, '+911');
  assert.equal(lease.account.loginType, 'otp');
});

test('leases distinct accounts from a pool (no collision)', () => {
  const reg = AccountRegistry.fromObject(fixture);
  const a = reg.checkout('SUBSCRIBED_USER');
  const b = reg.checkout('SUBSCRIBED_USER');
  assert.notEqual(a.account.phone, b.account.phone);
});

test('throws when the pool is exhausted', () => {
  const reg = AccountRegistry.fromObject(fixture);
  reg.checkout('IN_TRIAL_USER');
  assert.throws(() => reg.checkout('IN_TRIAL_USER'), NoAvailableAccountError);
});

test('releasing returns the account to the pool', () => {
  const reg = AccountRegistry.fromObject(fixture);
  const a = reg.checkout('IN_TRIAL_USER');
  a.release();
  const b = reg.checkout('IN_TRIAL_USER'); // should succeed again
  assert.equal(b.account.phone, '+913');
});

test('rejects an unknown user state', () => {
  assert.throws(() => AccountRegistry.fromObject({ accounts: { BOGUS_USER: [{ phone: '+9' }] } }));
});

test('carries per-account bypass code through', () => {
  const reg = AccountRegistry.fromObject(fixture);
  assert.equal(reg.checkout('IN_TRIAL_USER').account.bypassCode, '4242');
});
