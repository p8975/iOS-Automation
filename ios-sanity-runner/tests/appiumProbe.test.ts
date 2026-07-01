import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInteractive } from '../src/explore/appiumProbe.ts';

const XML = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<AppiumAUT>',
  '<XCUIElementTypeApplication type="XCUIElementTypeApplication" name="STAGE">',
  '  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Search" label="Search" enabled="true" visible="true" x="0" y="0"/>',
  '  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Subscribe Now" enabled="true" visible="true"/>',
  '  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Hidden" enabled="true" visible="false"/>',
  '  <XCUIElementTypeButton type="XCUIElementTypeButton" enabled="true" visible="true"/>',
  '  <XCUIElementTypeCell type="XCUIElementTypeCell" label="Naate" enabled="true" visible="true"/>',
  '  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Just text" visible="true"/>',
  "  <XCUIElementTypeButton type=\"XCUIElementTypeButton\" name=\"Neeraj's\" enabled=\"true\" visible=\"true\"/>",
  '  <XCUIElementTypeButton type="XCUIElementTypeButton" name="Search" label="Search" visible="true"/>',
  '  <XCUIElementTypeImage type="XCUIElementTypeImage" name="Watch on TV" visible="true"/>',
  '  <XCUIElementTypeOther type="XCUIElementTypeOther" name="Episode 1" accessible="true" visible="true"/>',
  '  <XCUIElementTypeOther type="XCUIElementTypeOther" name="layout-box" visible="true"/>',
  '  <XCUIElementTypeStaticText type="XCUIElementTypeStaticText" name="Quote &quot;Hi&quot;" accessible="true" visible="true"/>',
  '</AppiumAUT>',
].join('\n');

test('parses classic interactive controls and named images', () => {
  const labels = parseInteractive(XML).map((c) => c.label);
  assert.ok(labels.includes('Search'));
  assert.ok(labels.includes('Naate'));
  assert.ok(labels.includes('Subscribe Now')); // parse lists it; the CRAWLER denylists it
  assert.ok(labels.includes('Watch on TV')); // Image type is interactive (Flutter renders tappables as Image/Other)
});

test('includes Flutter accessible="true" nodes regardless of type, excludes plain layout', () => {
  const labels = parseInteractive(XML).map((c) => c.label);
  assert.ok(labels.includes('Episode 1')); // Other + accessible=true
  assert.equal(labels.includes('layout-box'), false); // Other, no accessible marker
});

test('drops hidden, unidentifiable, non-interactive, and duplicate controls', () => {
  const labels = parseInteractive(XML).map((c) => c.label);
  assert.equal(labels.includes('Hidden'), false); // visible=false
  assert.equal(labels.includes('Just text'), false); // StaticText, not interactive, not accessible
  assert.equal(labels.filter((l) => l === 'Search').length, 1); // de-duplicated
});

test('builds a type+name predicate selector; uses label when name is absent', () => {
  const byLabel = new Map(parseInteractive(XML).map((c) => [c.label, c.selector]));
  assert.equal(byLabel.get('Search'), "-ios predicate string:type == 'XCUIElementTypeButton' AND name == 'Search'");
  assert.equal(byLabel.get('Naate'), "-ios predicate string:type == 'XCUIElementTypeCell' AND label == 'Naate'");
});

test('decodes XML entities in the label and selector', () => {
  const c = parseInteractive(XML).find((x) => x.label.startsWith('Quote'));
  assert.equal(c?.label, 'Quote "Hi"');
  assert.ok(c?.selector.includes("name == 'Quote \"Hi\"'"));
});

test('escapes single quotes in the predicate value', () => {
  const sel = parseInteractive(XML).find((c) => c.label === "Neeraj's")?.selector ?? '';
  assert.ok(sel.includes("name == 'Neeraj\\'s'"));
});

test('honors the max cap', () => {
  assert.equal(parseInteractive(XML, undefined, 2).length, 2);
});
