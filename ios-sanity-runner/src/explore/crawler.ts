/**
 * The exploratory crawl algorithm, deliberately decoupled from Appium. It talks
 * to the device only through {@link UiProbe}, so the traversal logic (visited
 * de-duplication, the read-only denylist, depth/step/screen/time budgets,
 * navigation) is pure and unit-testable with a fake probe — no device.
 *
 * Strategy: depth-bounded walk anchored on the app ROOT. To reach (or return to)
 * any screen we reset to root and REPLAY the tap path that leads there, rather
 * than relying on `back()` — on a content app (e.g. tapping into a media player)
 * back-navigation is unreliable, so replay-from-root keeps coverage honest.
 * Immersive/terminal screens (players) are recorded but treated as leaves: we
 * never tap into them.
 */
import type { StepResult } from '../types.ts';
import { isDestructive } from './denylist.ts';

// A volatile UI (e.g. Flutter, whose accessibility tree churns) can make a
// single probe call hang or storm on stale elements. Bounding every operation
// guarantees the loop regains control and re-checks the budget — so a crawl
// always terminates within ~timeBudget rather than thrashing indefinitely.
const OP_TIMEOUT_MS = 8_000;
const LIST_TIMEOUT_MS = 12_000;
const RESET_TIMEOUT_MS = 30_000; // an app relaunch (terminate + activate + settle) is slow

/** Resolve with `fallback` if `p` doesn't settle (or rejects) within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback); }
    }, ms);
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref?: () => void }).unref!();
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } },
    );
  });
}

/** Like withTimeout but REJECTS on deadline — used for taps so a hung tap is recorded as a failed step. */
function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error(label + ' timed out after ' + ms + 'ms')); }
    }, ms);
    if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref?: () => void }).unref!();
    p.then(
      (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!settled) { settled = true; clearTimeout(timer); reject(e); } },
    );
  });
}

export interface UiElement {
  /** Accessibility id or visible label — used for logging and the denylist. */
  label: string;
  /** Opaque handle the probe uses to (re-)find and tap this element. */
  handle: unknown;
}

export interface ScreenHealth {
  ok: boolean;
  problem?: string;
}

/** The only contact surface with the device. Real impl: AppiumProbe. */
export interface UiProbe {
  /** Stable signature of the current screen, for visited de-duplication. */
  signature(): Promise<string>;
  /** Short human label for the current screen (step text). */
  describe(): Promise<string>;
  /** Health of the current screen — crashed / blank / error => ok:false. */
  health(): Promise<ScreenHealth>;
  /** True for an immersive/terminal screen (e.g. a media player) — record it, don't tap into it. */
  isLeaf(): Promise<boolean>;
  /** Interactive controls currently on screen. */
  interactive(): Promise<UiElement[]>;
  /** Tap a control returned by interactive() (re-finding it fresh). */
  tap(el: UiElement): Promise<void>;
  /** Return the app to its ROOT (e.g. relaunch) so a path can be replayed deterministically. */
  reset(): Promise<void>;
  /** Capture a screenshot; return a path RELATIVE to the artifacts dir. */
  capture(name: string): Promise<string | undefined>;
  /** Dismiss blocking interstitials (e.g. the dialect/culture popup or a native
   *  permission alert) sitting over the screen, so the reads/taps that follow act
   *  on the real content beneath. Optional — a no-op when unimplemented. */
  dismissInterstitials?(): Promise<void>;
}

export interface CrawlOptions {
  deny: readonly string[];
  maxSteps: number;
  maxDepth: number;
  maxScreens: number;
  perScreenTaps: number;
  timeBudgetMs: number;
  /** Injectable clock (tests). Defaults to Date.now. */
  now?: () => number;
  /** Cooperative cancellation (an AbortSignal satisfies this). */
  signal?: { aborted: boolean };
}

export interface CrawlOutcome {
  steps: StepResult[];
  screensVisited: number;
  problems: number;
  stoppedReason: 'completed' | 'budget' | 'aborted';
}

export async function crawl(
  probe: UiProbe,
  opts: CrawlOptions,
  onStep: (step: StepResult) => void,
): Promise<CrawlOutcome> {
  const now = opts.now ?? ((): number => Date.now());
  const start = now();
  const visited = new Set<string>();
  const steps: StepResult[] = [];
  let problems = 0;
  let screenCounter = 0;

  const aborted = (): boolean => Boolean(opts.signal?.aborted);
  const budgetHit = (): boolean =>
    steps.length >= opts.maxSteps ||
    visited.size >= opts.maxScreens ||
    now() - start >= opts.timeBudgetMs;

  const record = (step: StepResult): void => {
    steps.push(step);
    onStep(step);
    if (!step.ok) problems++;
  };

  /** Reset to root and replay `path` to land on a screen — reliable on a content app where back() isn't. */
  async function navigateTo(path: UiElement[]): Promise<boolean> {
    if (aborted() || budgetHit()) return false;
    // Reset is a GATE: fully complete it before issuing any other command.
    // Querying a mid-relaunch (terminated) app makes getPageSource hang ~16s
    // each and queues behind the pending re-activation. If reset can't finish,
    // abandon this branch rather than crawl a half-dead app.
    const didReset = await withTimeout(probe.reset().then(() => true), RESET_TIMEOUT_MS, false);
    if (!didReset) return false;
    // A warm reset lands on home, where the dialect popup can reappear — clear it
    // before replaying taps so the path isn't blocked by the overlay.
    if (probe.dismissInterstitials) await withTimeout(probe.dismissInterstitials(), OP_TIMEOUT_MS, undefined);
    for (const el of path) {
      if (aborted() || budgetHit()) return false;
      try {
        await withDeadline(probe.tap(el), OP_TIMEOUT_MS, 'replay tap: ' + el.label);
      } catch {
        return false; // a control on the path is gone (dynamic content) — abandon this branch
      }
    }
    return true;
  }

  /** Explore the screen we are CURRENTLY on, whose tap-path from root is `path`. */
  async function exploreCurrent(path: UiElement[]): Promise<void> {
    if (aborted() || budgetHit()) return;

    // Clear any blocking interstitial (e.g. the dialect popup) sitting over the
    // screen so the signature/health/tap reads below act on the content beneath.
    if (probe.dismissInterstitials) await withTimeout(probe.dismissInterstitials(), OP_TIMEOUT_MS, undefined);

    const sig = await withTimeout(probe.signature(), OP_TIMEOUT_MS, 'timeout-' + path.length);
    if (visited.has(sig)) return;
    visited.add(sig);
    const idx = ++screenCounter;

    const t0 = now();
    const label = await withTimeout(probe.describe(), OP_TIMEOUT_MS, 'screen');
    const health = await withTimeout(probe.health(), OP_TIMEOUT_MS, { ok: false, problem: 'health check timed out' });
    const leaf = await withTimeout(probe.isLeaf(), OP_TIMEOUT_MS, false);
    const shot = await withTimeout<string | undefined>(probe.capture('screen-' + idx), OP_TIMEOUT_MS, undefined);
    // Enumerate the controls once — both as the tap candidates AND as the element
    // inventory the AI judge uses to validate the screen.
    const candidates = await withTimeout<UiElement[]>(probe.interactive(), LIST_TIMEOUT_MS, []);
    record({
      ok: health.ok,
      action: 'screen: ' + label,
      detail: health.ok ? (leaf ? 'reached (leaf)' : 'reached') : undefined,
      error: health.ok ? undefined : health.problem,
      screenshotPath: shot,
      durationMs: now() - t0,
      elements: candidates.map((c) => c.label).filter((l) => l.trim().length > 0),
    });

    // Never tap INTO an immersive/terminal screen (a player), and respect depth.
    if (leaf || path.length >= opts.maxDepth) return;

    // Tap the screen's controls, RE-READING the live set each round rather than
    // iterating the list captured on arrival. Returning to this screen (reset +
    // replay) re-renders the tree, and dynamic content — e.g. search results —
    // can differ between visits, so a control seen on arrival may be gone. We only
    // ever tap a control CONFIRMED present in the current tree; a label that has
    // since vanished is skipped (dynamic content, not a defect) instead of being
    // charged as a failed tap. `tried` (by label) stops us re-tapping the same
    // control and guarantees the loop makes progress. Read-only safety still
    // applies: an unlabelled or denylisted control is never tapped.
    const tried = new Set<string>();
    const nextControl = (live: UiElement[]): UiElement | undefined =>
      live.find((c) => c.label.trim().length > 0 && !tried.has(c.label) && !isDestructive(c.label, opts.deny));

    let taps = 0;
    while (!aborted() && !budgetHit() && taps < opts.perScreenTaps) {
      const live = await withTimeout<UiElement[]>(probe.interactive(), LIST_TIMEOUT_MS, []);
      const el = nextControl(live);
      if (!el) break; // nothing new currently on screen to try
      tried.add(el.label);
      taps++;
      const tt0 = now();
      try {
        await withDeadline(probe.tap(el), OP_TIMEOUT_MS, 'tap');
      } catch (err) {
        record({ ok: false, action: 'tap: ' + el.label, error: err instanceof Error ? err.message : String(err), durationMs: now() - tt0 });
        if (!(await navigateTo(path))) return; // recover position before the next control
        continue;
      }
      const after = await withTimeout(probe.signature(), OP_TIMEOUT_MS, sig);
      if (after === sig) continue; // no navigation — still here, try the next control
      if (!visited.has(after)) {
        record({ ok: true, action: 'tap: ' + el.label, detail: '→ new screen', durationMs: now() - tt0 });
        await exploreCurrent([...path, el]); // we are now ON the child screen
      }
      // Return to THIS screen for the next control — reliably, via reset + replay.
      if (!(await navigateTo(path))) return;
    }
  }

  if (await navigateTo([])) {
    await exploreCurrent([]);
  }
  const stoppedReason = aborted() ? 'aborted' : budgetHit() ? 'budget' : 'completed';
  return { steps, screensVisited: visited.size, problems, stoppedReason };
}
