import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import yaml from 'js-yaml';
import { suiteSchema, type SuiteDefinition } from './schema.ts';
import { RunnerError } from '../types.ts';

/** Parse + validate a single suite YAML file. Throws with a readable message. */
export function loadSuiteFile(path: string): SuiteDefinition {
  const raw = yaml.load(readFileSync(path, 'utf8'));
  const parsed = suiteSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new RunnerError(`invalid suite "${basename(path)}":\n${issues}`);
  }
  return parsed.data;
}

/** Load every *.yaml/*.yml suite in a directory. */
export function loadSuiteDir(dir: string): SuiteDefinition[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => loadSuiteFile(join(dir, f)));
}
