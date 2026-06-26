import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLocator } from '../src/locators/locatorEngine.ts';

test('accessibility_id maps to ~ selector', () => {
  const r = resolveLocator({ accessibility_id: 'home_root' });
  assert.equal(r.selector, '~home_root');
  assert.equal(r.strategy, 'accessibility_id');
  assert.equal(r.fragile, false);
});

test('predicate maps to -ios predicate string', () => {
  const r = resolveLocator({ predicate: "name == 'foo'" });
  assert.equal(r.selector, "-ios predicate string:name == 'foo'");
});

test('class_chain maps to -ios class chain', () => {
  const r = resolveLocator({ class_chain: '**/XCUIElementTypeButton' });
  assert.equal(r.selector, '-ios class chain:**/XCUIElementTypeButton');
});

test('text builds a label/name/value predicate', () => {
  const r = resolveLocator({ text: 'Premium' });
  assert.match(r.selector!, /label == 'Premium' OR name == 'Premium' OR value == 'Premium'/);
});

test('coordinates resolve to a fragile coordinate tap', () => {
  const r = resolveLocator({ coordinates: { x: 10, y: 20 } });
  assert.equal(r.selector, null);
  assert.deepEqual(r.coordinates, { x: 10, y: 20 });
  assert.equal(r.fragile, true);
});
