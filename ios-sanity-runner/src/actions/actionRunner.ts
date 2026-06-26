import type { Driver } from '../session/appiumSession.ts';
import type { LocatorSpec } from '../suite/schema.ts';
import type { UserState } from '../types.ts';
import { resolveLocator, describeLocator } from '../locators/locatorEngine.ts';
import { RunnerError, type StepResult } from '../types.ts';

export interface ActionContext {
  /** State detected at runtime — drives `branch`. */
  detectedState: UserState;
  /** Reusable named flows referenced by `use_flow`. */
  flows: Record<string, unknown[]>;
  /** Default element wait, ms. */
  defaultTimeoutMs: number;
}

type Step = Record<string, unknown>;

/**
 * Executes validated YAML steps against a live driver. Each step is dispatched
 * by its single key. Branching reads `ctx.detectedState`, so a case follows the
 * state DETECTED at runtime rather than a fixed linear path.
 */
export class ActionRunner {
  private readonly driver: Driver;
  private readonly ctx: ActionContext;

  constructor(driver: Driver, ctx: ActionContext) {
    this.driver = driver;
    this.ctx = ctx;
  }

  async runSteps(steps: unknown[]): Promise<StepResult[]> {
    const results: StepResult[] = [];
    for (const step of steps) {
      const result = await this.runStep(step as Step);
      results.push(result);
      if (!result.ok) break; // fail fast within a flow
    }
    return results;
  }

  private async runStep(step: Step): Promise<StepResult> {
    const action = Object.keys(step)[0] ?? 'unknown';
    const started = Date.now();
    try {
      await this.dispatch(action, step);
      return { ok: true, action, durationMs: Date.now() - started };
    } catch (err) {
      return {
        ok: false,
        action,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      };
    }
  }

  private async dispatch(action: string, step: Step): Promise<void> {
    switch (action) {
      case 'tap':
        return this.tap(step.tap as LocatorSpec);
      case 'type':
        return this.type(step.type as LocatorSpec & { text: string });
      case 'wait_for':
        return this.waitFor(step.wait_for as LocatorSpec & { timeout: number });
      case 'assert_visible':
        return this.assertVisible(step.assert_visible as LocatorSpec, true);
      case 'assert_not_visible':
        return this.assertVisible(step.assert_not_visible as LocatorSpec, false);
      case 'assert_text':
        return this.assertText(step.assert_text as LocatorSpec & { equals?: string; contains?: string });
      case 'swipe':
        return this.swipe(step.swipe as { direction?: string });
      case 'scroll':
        return this.scroll(step.scroll as { to: LocatorSpec; direction: 'up' | 'down' });
      case 'fail':
        throw new RunnerError(String(step.fail));
      case 'use_flow':
        return this.useFlow(String(step.use_flow));
      case 'branch':
        return this.branch(step.branch as { cases: Record<string, unknown[]> });
      default:
        throw new RunnerError(`unknown action "${action}"`);
    }
  }

  private async element(spec: LocatorSpec, timeoutMs = this.ctx.defaultTimeoutMs) {
    const loc = resolveLocator(spec);
    if (loc.selector === null) throw new RunnerError('coordinate locator has no element handle');
    const el = await this.driver.$(loc.selector);
    await el.waitForExist({ timeout: timeoutMs });
    return el;
  }

  private async tap(spec: LocatorSpec): Promise<void> {
    const loc = resolveLocator(spec);
    if (loc.coordinates) {
      await this.driver.execute('mobile: tap', { x: loc.coordinates.x, y: loc.coordinates.y });
      return;
    }
    const el = await this.element(spec);
    await el.click();
  }

  private async type(spec: LocatorSpec & { text: string }): Promise<void> {
    const el = await this.element(spec);
    await el.setValue(spec.text);
  }

  private async waitFor(spec: LocatorSpec & { timeout: number }): Promise<void> {
    await this.element(spec, spec.timeout * 1000);
  }

  private async assertVisible(spec: LocatorSpec, expected: boolean): Promise<void> {
    const loc = resolveLocator(spec);
    if (loc.selector === null) throw new RunnerError('cannot assert visibility on a coordinate');
    const el = await this.driver.$(loc.selector);
    const exists = await el.isExisting();
    const visible = exists && (await el.isDisplayed().catch(() => false));
    if (visible !== expected) {
      throw new RunnerError(
        `expected ${describeLocator(spec)} to be ${expected ? 'visible' : 'absent'}, was ${visible ? 'visible' : 'absent'}`,
      );
    }
  }

  private async assertText(spec: LocatorSpec & { equals?: string; contains?: string }): Promise<void> {
    const el = await this.element(spec);
    const text = await el.getText();
    if (spec.equals !== undefined && text !== spec.equals) {
      throw new RunnerError(`text "${text}" != expected "${spec.equals}"`);
    }
    if (spec.contains !== undefined && !text.includes(spec.contains)) {
      throw new RunnerError(`text "${text}" does not contain "${spec.contains}"`);
    }
  }

  private async swipe(spec: { direction?: string }): Promise<void> {
    await this.driver.execute('mobile: swipe', { direction: spec.direction ?? 'up' });
  }

  private async scroll(spec: { to: LocatorSpec; direction: 'up' | 'down' }): Promise<void> {
    const loc = resolveLocator(spec.to);
    if (loc.selector === null) throw new RunnerError('scroll target must be an element locator');
    await this.driver.execute('mobile: scroll', { direction: spec.direction, predicateString: loc.selector });
  }

  private async useFlow(name: string): Promise<void> {
    const flow = this.ctx.flows[name];
    if (!flow) throw new RunnerError(`use_flow: unknown flow "${name}"`);
    const results = await this.runSteps(flow);
    const failed = results.find((r) => !r.ok);
    if (failed) throw new RunnerError(`flow "${name}" failed at ${failed.action}: ${failed.error}`);
  }

  private async branch(spec: { cases: Record<string, unknown[]> }): Promise<void> {
    const chosen = spec.cases[this.ctx.detectedState] ?? spec.cases.default;
    if (!chosen) {
      throw new RunnerError(`branch: no case for state ${this.ctx.detectedState} and no default`);
    }
    const results = await this.runSteps(chosen);
    const failed = results.find((r) => !r.ok);
    if (failed) throw new RunnerError(`branch[${this.ctx.detectedState}] failed: ${failed.error}`);
  }
}
