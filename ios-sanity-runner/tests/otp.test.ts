import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOtpProvider, BypassCodeProvider } from '../src/otp/index.ts';
import type { Account } from '../src/types.ts';

const account: Account = { state: 'SUBSCRIBED_USER', phone: '+911', loginType: 'otp' };

test('factory selects bypass by default', () => {
  const p = createOtpProvider({ defaultStrategy: 'bypass', bypassCode: '000000' });
  assert.ok(p instanceof BypassCodeProvider);
  assert.equal(p.name, 'bypass');
});

test('bypass returns the global code', async () => {
  const p = createOtpProvider({ defaultStrategy: 'bypass', bypassCode: '123456' });
  assert.equal(await p.getCode(account), '123456');
});

test('per-account bypass code overrides the global code', async () => {
  const p = createOtpProvider({ defaultStrategy: 'bypass', bypassCode: '000000' });
  assert.equal(await p.getCode({ ...account, bypassCode: '999999' }), '999999');
});

test('bypass fails loudly when no code is configured', async () => {
  const p = createOtpProvider({ defaultStrategy: 'bypass' });
  await assert.rejects(() => p.getCode(account));
});

test('selecting twilio without config throws at construction', () => {
  assert.throws(() => createOtpProvider({ defaultStrategy: 'twilio' }));
});
