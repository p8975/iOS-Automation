/**
 * Client for pushing runs into a live dashboard from an EXTERNAL producer (a
 * separate process — e.g. the autonomous exploratory-QA loop). Two levels:
 *
 *   - {@link ingestRun}: push a whole assembled {@link StoredRun} in one call.
 *   - {@link emitRunEvent} / {@link LiveRun}: stream the same event sequence a
 *     native engine run emits, so suites and steps appear on the dashboard in
 *     real time as they complete.
 *
 * Zero-dependency (global `fetch`, Node ≥18). Network failures never throw —
 * every call returns a result object so a producer stays resilient when the
 * dashboard is not running.
 */
import type { RunEvent, SuiteRef } from '../events/runEvents.ts';
import type { StoredRun } from './runStore.ts';
import type { StepResult, SuiteResult } from '../types.ts';

export interface PushResult {
  ok: boolean;
  runId?: string;
  status?: number;
  error?: string;
}

async function postJson(url: string, body: unknown): Promise<PushResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let parsed: { runId?: string; error?: string } = {};
    try {
      parsed = (await res.json()) as { runId?: string; error?: string };
    } catch {
      /* non-JSON body — status still tells us enough */
    }
    return { ok: res.ok, status: res.status, runId: parsed.runId, error: res.ok ? undefined : parsed.error };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Push a whole assembled run. `baseUrl` e.g. "http://localhost:4500". */
export function ingestRun(baseUrl: string, run: StoredRun): Promise<PushResult> {
  return postJson(baseUrl.replace(/\/$/, '') + '/api/runs/ingest', run);
}

/** Emit a single RunEvent into the dashboard's hub (live streaming primitive). */
export function emitRunEvent(baseUrl: string, event: RunEvent): Promise<PushResult> {
  return postJson(baseUrl.replace(/\/$/, '') + '/api/runs/event', event);
}

/**
 * Streams one run's lifecycle to a dashboard as suites/steps complete. Drive it
 * from a producer that owns the whole run in one process; each call is a live
 * frame on the dashboard. Step indices auto-increment per suite.
 */
export class LiveRun {
  readonly #base: string;
  readonly #runId: string;
  #index = 0;

  constructor(baseUrl: string, runId: string) {
    this.#base = baseUrl.replace(/\/$/, '');
    this.#runId = runId;
  }

  get runId(): string {
    return this.#runId;
  }

  start(suites: SuiteRef[]): Promise<PushResult> {
    return emitRunEvent(this.#base, {
      type: 'run_started',
      runId: this.#runId,
      startedAt: new Date().toISOString(),
      total: suites.length,
      suites,
    });
  }

  suiteStart(ref: SuiteRef): Promise<PushResult> {
    this.#index = 0;
    return emitRunEvent(this.#base, {
      type: 'suite_started',
      runId: this.#runId,
      suite: ref.suite,
      target: ref.target,
      state: ref.state,
      startedAt: new Date().toISOString(),
    });
  }

  step(ref: SuiteRef, step: StepResult): Promise<PushResult> {
    return emitRunEvent(this.#base, {
      type: 'step_finished',
      runId: this.#runId,
      suite: ref.suite,
      target: ref.target,
      index: this.#index++,
      step,
    });
  }

  suiteFinish(result: SuiteResult): Promise<PushResult> {
    return emitRunEvent(this.#base, {
      type: 'suite_finished',
      runId: this.#runId,
      suite: result.suite,
      target: result.target,
      result,
    });
  }

  finish(results: readonly SuiteResult[]): Promise<PushResult> {
    const passed = results.filter((r) => r.ok).length;
    return emitRunEvent(this.#base, {
      type: 'run_finished',
      runId: this.#runId,
      finishedAt: new Date().toISOString(),
      total: results.length,
      passed,
      failed: results.length - passed,
      ok: results.length - passed === 0,
    });
  }
}
