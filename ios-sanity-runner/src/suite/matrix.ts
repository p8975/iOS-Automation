import type { LocatorSpec } from './schema.ts';

/** One state's expected screen contents: which a11y ids are present / absent. */
export interface MatrixRow {
  visible?: string[];
  absent?: string[];
}

/** A named matrix: state -> expected contents. Adding a state = adding a row. */
export type ExpectationMatrix = Record<string, MatrixRow>;

/**
 * Expands a matrix row for the detected state into concrete assert steps. This
 * keeps state-aware expectations DATA (a table) instead of hand-written
 * branches, so the case stays maintainable as states grow.
 */
export function expandMatrix(matrix: ExpectationMatrix, state: string): Array<Record<string, LocatorSpec>> {
  const row = matrix[state];
  if (!row) {
    throw new Error(`matrix has no row for state "${state}" (add one, or use a 'default' row)`);
  }
  const steps: Array<Record<string, LocatorSpec>> = [];
  for (const id of row.visible ?? []) steps.push({ assert_visible: { accessibility_id: id } });
  for (const id of row.absent ?? []) steps.push({ assert_not_visible: { accessibility_id: id } });
  return steps;
}
