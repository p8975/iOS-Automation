import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDestructive, DEFAULT_DENY } from '../src/explore/denylist.ts';

test('blocks financial / destructive / auth / app-escaping controls', () => {
  for (const bad of [
    'Subscribe Now',
    'cta_start_trial',
    'btn_logout',
    'Delete account',
    'Proceed to Pay',
    'Share via WhatsApp',
    'upgrade_plan',
    'confirm_purchase',
  ]) {
    assert.equal(isDestructive(bad), true, `"${bad}" should be blocked`);
  }
});

test('allows benign navigation controls', () => {
  for (const ok of [
    'tab_account',
    'home_screen_root',
    'Search',
    'Settings',
    'tab_downloads',
    'open_profile',
    'My List',
    'banner_trial_days_left',
  ]) {
    assert.equal(isDestructive(ok), false, `"${ok}" should be allowed`);
  }
});

test('honors a custom denylist instead of the defaults', () => {
  assert.equal(isDestructive('special_button', ['special']), true);
  assert.equal(isDestructive('special_button', DEFAULT_DENY), false);
});
