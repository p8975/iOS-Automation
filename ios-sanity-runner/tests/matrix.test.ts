import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandMatrix } from '../src/suite/matrix.ts';

const matrix = {
  SUBSCRIBED_USER: { visible: ['badge_premium'], absent: ['cta_start_trial'] },
  TRIAL_ELIGIBLE_USER: { visible: ['cta_start_trial'] },
};

test('expands a row into assert_visible / assert_not_visible steps', () => {
  assert.deepEqual(expandMatrix(matrix, 'SUBSCRIBED_USER'), [
    { assert_visible: { accessibility_id: 'badge_premium' } },
    { assert_not_visible: { accessibility_id: 'cta_start_trial' } },
  ]);
});

test('a state with only visible ids yields only assert_visible', () => {
  assert.deepEqual(expandMatrix(matrix, 'TRIAL_ELIGIBLE_USER'), [
    { assert_visible: { accessibility_id: 'cta_start_trial' } },
  ]);
});

test('an unknown state throws (no silent pass)', () => {
  assert.throws(() => expandMatrix(matrix, 'PAUSED_USER'));
});
