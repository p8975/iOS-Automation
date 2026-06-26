import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadSuiteFile } from '../src/suite/loader.ts';
import { suiteSchema, locatorSchema } from '../src/suite/schema.ts';

test('the shipped example suite is valid', () => {
  const suite = loadSuiteFile(resolve('suites/home_entitlement_sanity.yaml'));
  assert.equal(suite.suite, 'home_entitlement_sanity');
  assert.equal(suite.requires, 'SUBSCRIBED_USER');
  assert.ok(suite.steps.length > 0);
});

test('a locator with two strategies is rejected', () => {
  const bad = locatorSchema.safeParse({ accessibility_id: 'a', xpath: '//b' });
  assert.equal(bad.success, false);
});

test('a locator with exactly one strategy passes', () => {
  assert.equal(locatorSchema.safeParse({ accessibility_id: 'a' }).success, true);
});

test('a suite requiring an unknown state is rejected', () => {
  const bad = suiteSchema.safeParse({
    suite: 's',
    requires: 'GHOST_USER',
    steps: [{ tap: { accessibility_id: 'x' } }],
  });
  assert.equal(bad.success, false);
});

test('a suite missing required fields is rejected', () => {
  assert.equal(suiteSchema.safeParse({ description: 'no suite name' }).success, false);
});
