/**
 * Disk-backed live run state. Subscribes to a {@link RunEvent} stream and keeps
 * a `StoredRun` per run id, both in memory (for fast SSE snapshots) and on disk
 * under `<artifactsDir>/runs/<id>/run.json` (so history survives the process and
 * a run started without the dashboard still shows up later).
 *
 * The store is the single source of truth the dashboard renders — events mutate
 * it, the server reads it. Nothing here touches a device or the engine.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { StepResult, Target, UserState } from '../types.ts';
import type { RunEvent } from '../events/runEvents.ts';

export type SuiteStatus = 'pending' | 'running' | 'passed' | 'failed';
export type RunStatus = 'running' | 'passed' | 'failed';

export interface StoredSuite {
  suite: string;
  state: UserState;
  target: Target;
  status: SuiteStatus;
  steps: StepResult[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface StoredRun {
  id: string;
  startedAt: string;
  finishedAt?: string;
  status: RunStatus;
  total: number;
  passed: number;
  failed: number;
  suites: StoredSuite[];
}

function fsSafe(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '-');
}

export class RunStore {
  readonly #runsDir: string;
  readonly #runs = new Map<string, StoredRun>();
  #activeId: string | null = null;

  constructor(artifactsDir: string) {
    this.#runsDir = join(artifactsDir, 'runs');
  }

  /** Apply one event: update memory, then persist. Bound for `hub.subscribe`. */
  handle = (event: RunEvent): void => {
    switch (event.type) {
      case 'run_started': {
        const run: StoredRun = {
          id: event.runId,
          startedAt: event.startedAt,
          status: 'running',
          total: event.total,
          passed: 0,
          failed: 0,
          suites: event.suites.map((s) => ({
            suite: s.suite,
            state: s.state,
            target: s.target,
            status: 'pending',
            steps: [],
          })),
        };
        this.#runs.set(run.id, run);
        this.#activeId = run.id;
        this.#persist(run);
        break;
      }
      case 'suite_started': {
        const run = this.#runs.get(event.runId);
        const suite = run && this.#find(run, event.suite, event.target);
        if (run && suite) {
          suite.status = 'running';
          suite.startedAt = event.startedAt;
          this.#persist(run);
        }
        break;
      }
      case 'step_finished': {
        const run = this.#runs.get(event.runId);
        const suite = run && this.#find(run, event.suite, event.target);
        if (run && suite) {
          suite.steps[event.index] = event.step;
          this.#persist(run);
        }
        break;
      }
      case 'suite_finished': {
        const run = this.#runs.get(event.runId);
        const suite = run && this.#find(run, event.suite, event.target);
        if (run && suite) {
          suite.status = event.result.ok ? 'passed' : 'failed';
          suite.steps = event.result.steps;
          suite.error = event.result.error;
          suite.startedAt = event.result.startedAt;
          suite.finishedAt = event.result.finishedAt;
          run.passed = run.suites.filter((s) => s.status === 'passed').length;
          run.failed = run.suites.filter((s) => s.status === 'failed').length;
          this.#persist(run);
        }
        break;
      }
      case 'run_finished': {
        const run = this.#runs.get(event.runId);
        if (run) {
          run.finishedAt = event.finishedAt;
          run.passed = event.passed;
          run.failed = event.failed;
          run.status = event.ok ? 'passed' : 'failed';
          this.#persist(run);
        }
        break;
      }
    }
  };

  /** The most recently started run held in memory (for the SSE snapshot). */
  current(): StoredRun | null {
    return this.#activeId ? (this.#runs.get(this.#activeId) ?? null) : null;
  }

  /**
   * Ingest a complete, externally-produced run (e.g. the autonomous exploratory
   * loop) as a first-class run: upsert into memory and persist to disk so it
   * lists and renders exactly like an engine run. Marks it active so it shows on
   * the SSE snapshot. Additive — never touches the event pipeline.
   */
  importRun(run: StoredRun): void {
    this.#runs.set(run.id, run);
    this.#activeId = run.id;
    this.#persist(run);
  }

  getRun(id: string): StoredRun | null {
    const live = this.#runs.get(id);
    if (live) return live;
    const file = join(this.#runsDir, fsSafe(id), 'run.json');
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as StoredRun;
    } catch {
      return null;
    }
  }

  /** All persisted runs, newest first. Merges in-memory runs over disk copies. */
  listRuns(): StoredRun[] {
    const byId = new Map<string, StoredRun>();
    if (existsSync(this.#runsDir)) {
      for (const entry of readdirSync(this.#runsDir)) {
        const file = join(this.#runsDir, entry, 'run.json');
        if (!existsSync(file)) continue;
        try {
          const run = JSON.parse(readFileSync(file, 'utf8')) as StoredRun;
          byId.set(run.id, run);
        } catch {
          /* skip unreadable run */
        }
      }
    }
    for (const [id, run] of this.#runs) byId.set(id, run);
    return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  #find(run: StoredRun, suite: string, target: string): StoredSuite | undefined {
    return run.suites.find((s) => s.suite === suite && s.target === target);
  }

  #persist(run: StoredRun): void {
    try {
      const dir = join(this.#runsDir, fsSafe(run.id));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2) + '\n');
    } catch {
      /* best-effort: a write failure must never break a run */
    }
  }
}
