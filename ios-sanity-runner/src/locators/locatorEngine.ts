import type { LocatorSpec } from '../suite/schema.ts';
import { LocatorNotFoundError } from '../types.ts';

/**
 * Resolves a YAML locator into an Appium/WebdriverIO selector, honoring the
 * priority ladder: accessibility_id ▸ predicate ▸ class_chain ▸ xpath ▸ text
 * ▸ coordinates. Stable locators are strongly preferred; raw coordinates are
 * the last resort and are reported as such so flaky cases are easy to spot.
 */
export interface ResolvedLocator {
  /** WebdriverIO selector string, or null when this is a coordinate tap. */
  selector: string | null;
  coordinates?: { x: number; y: number };
  /** Which strategy resolved it — surfaced in reports. */
  strategy: 'accessibility_id' | 'predicate' | 'class_chain' | 'xpath' | 'text' | 'coordinates';
  /** True for raw coordinates — discouraged, flagged in reporting. */
  fragile: boolean;
}

export function resolveLocator(spec: LocatorSpec): ResolvedLocator {
  if (spec.accessibility_id !== undefined) {
    return { selector: `~${spec.accessibility_id}`, strategy: 'accessibility_id', fragile: false };
  }
  if (spec.predicate !== undefined) {
    return { selector: `-ios predicate string:${spec.predicate}`, strategy: 'predicate', fragile: false };
  }
  if (spec.class_chain !== undefined) {
    return { selector: `-ios class chain:${spec.class_chain}`, strategy: 'class_chain', fragile: false };
  }
  if (spec.xpath !== undefined) {
    return { selector: spec.xpath, strategy: 'xpath', fragile: false };
  }
  if (spec.text !== undefined) {
    // Match label/name/value so author can target visible text without an a11y id.
    const v = escapePredicate(spec.text);
    const predicate = `label == '${v}' OR name == '${v}' OR value == '${v}'`;
    return { selector: `-ios predicate string:${predicate}`, strategy: 'text', fragile: false };
  }
  if (spec.coordinates !== undefined) {
    return { selector: null, coordinates: spec.coordinates, strategy: 'coordinates', fragile: true };
  }
  throw new LocatorNotFoundError('locator specifies no resolution strategy');
}

function escapePredicate(value: string): string {
  return value.replace(/'/g, "\\'");
}

export function describeLocator(spec: LocatorSpec): string {
  const r = resolveLocator(spec);
  return r.coordinates ? `coords(${r.coordinates.x},${r.coordinates.y})` : `${r.strategy}:${r.selector}`;
}
