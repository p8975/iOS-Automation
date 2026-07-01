/**
 * Live run events. The runner is batch-oriented (a suite's result lands only
 * when it finishes), so to watch progress in real time we emit a small stream
 * of events as suites and steps complete. This module is the single integration
 * point: a dashboard, a Slack reporter, or any other consumer just subscribes
 * to an {@link EventHub} — the engine itself stays unaware of who is listening.
 *
 * Everything here is additive: passing an observer is optional, so the existing
 * return-value API and the CLI behave identically when nobody is watching.
 */
import type { SuiteResult, StepResult, Target, UserState } from '../types.ts';

/** One suite in a run, with its resolved target (known before it executes). */
export interface SuiteRef {
  suite: string;
  state: UserState;
  target: Target;
}

/**
 * A run's lifecycle as a discriminated union. Keyed by `type`; `runId` ties
 * every event to one batch. Suites are identified by `suite` + `target` (unique
 * within a single run).
 */
export type RunEvent =
  | { type: 'run_started'; runId: string; startedAt: string; total: number; suites: SuiteRef[] }
  | { type: 'suite_started'; runId: string; suite: string; target: Target; state: UserState; startedAt: string }
  | { type: 'step_finished'; runId: string; suite: string; target: Target; index: number; step: StepResult }
  | { type: 'suite_finished'; runId: string; suite: string; target: Target; result: SuiteResult }
  | { type: 'run_finished'; runId: string; finishedAt: string; total: number; passed: number; failed: number; ok: boolean };

export type RunObserver = (event: RunEvent) => void;

/**
 * A trivial synchronous fan-out. Observers are isolated: one that throws can
 * never abort a run or starve the others. Subscribe returns an unsubscribe fn.
 */
export class EventHub {
  readonly #observers = new Set<RunObserver>();

  subscribe(observer: RunObserver): () => void {
    this.#observers.add(observer);
    return () => {
      this.#observers.delete(observer);
    };
  }

  emit(event: RunEvent): void {
    // Snapshot first so an observer may unsubscribe itself during dispatch.
    for (const observer of [...this.#observers]) {
      try {
        observer(event);
      } catch {
        /* an observer must never break a run */
      }
    }
  }

  get size(): number {
    return this.#observers.size;
  }
}

let seq = 0;

/** A filesystem-safe, monotonic-within-process run id. */
export function newRunId(): string {
  seq += 1;
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(seq).padStart(3, '0')}`;
}

export function runStartedEvent(runId: string, startedAt: string, suites: SuiteRef[]): RunEvent {
  return { type: 'run_started', runId, startedAt, total: suites.length, suites };
}

export function runFinishedEvent(runId: string, finishedAt: string, results: readonly SuiteResult[]): RunEvent {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  return { type: 'run_finished', runId, finishedAt, total: results.length, passed, failed, ok: failed === 0 };
}
