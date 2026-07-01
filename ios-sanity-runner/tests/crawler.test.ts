import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawl, type CrawlOptions, type ScreenHealth, type UiElement, type UiProbe } from '../src/explore/crawler.ts';
import { DEFAULT_DENY } from '../src/explore/denylist.ts';
import type { StepResult } from '../src/types.ts';

interface Link {
  label: string;
  to: string | null;
}
interface Screen {
  sig: string;
  label: string;
  ok: boolean;
  leaf?: boolean;
  links: Link[];
}

/**
 * A deterministic in-memory app graph standing in for a real device. Models the
 * reset-and-replay contract: reset() returns to `start`; tap() navigates by the
 * control's label among the CURRENT screen's links (so replaying a path re-taps
 * the same labels from root). There is no back() — that is the whole point.
 */
class FakeProbe implements UiProbe {
  readonly #screens: Record<string, Screen>;
  readonly #start: string;
  cur: string;
  resets = 0;
  readonly tapped: string[] = [];

  constructor(screens: Record<string, Screen>, start: string) {
    this.#screens = screens;
    this.#start = start;
    this.cur = start;
  }

  #s(): Screen {
    const s = this.#screens[this.cur];
    if (!s) throw new Error('unknown screen ' + this.cur);
    return s;
  }

  async signature(): Promise<string> {
    return this.#s().sig;
  }
  async describe(): Promise<string> {
    return this.#s().label;
  }
  async health(): Promise<ScreenHealth> {
    return this.#s().ok ? { ok: true } : { ok: false, problem: 'bad screen: ' + this.cur };
  }
  async isLeaf(): Promise<boolean> {
    return Boolean(this.#s().leaf);
  }
  async interactive(): Promise<UiElement[]> {
    return this.#s().links.map((l) => ({ label: l.label, handle: l.label }));
  }
  async tap(el: UiElement): Promise<void> {
    const link = this.#s().links.find((l) => l.label === el.handle);
    if (!link) throw new Error('control not present: ' + String(el.handle));
    this.tapped.push(link.label);
    if (link.to && link.to !== this.cur) this.cur = link.to;
  }
  async reset(): Promise<void> {
    this.resets++;
    this.cur = this.#start;
  }
  async capture(name: string): Promise<string | undefined> {
    return 'shots/' + name + '.png';
  }
}

const GRAPH: Record<string, Screen> = {
  home: {
    sig: 'home',
    label: 'Home',
    ok: true,
    links: [
      { label: 'tab_account', to: 'account' },
      { label: 'tab_search', to: 'search' },
      { label: 'Subscribe Now', to: 'pay' }, // destructive — must never be tapped
      { label: 'tab_home', to: 'home' }, // self-link / no-op
    ],
  },
  account: { sig: 'account', label: 'Account', ok: true, links: [{ label: 'open_profile', to: 'profile' }] },
  search: { sig: 'search', label: 'Search', ok: true, links: [] },
  profile: { sig: 'profile', label: 'Profile', ok: true, links: [] },
  pay: { sig: 'pay', label: 'Payment', ok: true, links: [] },
};

function opts(over: Partial<CrawlOptions> = {}): CrawlOptions {
  return {
    deny: DEFAULT_DENY,
    maxSteps: 100,
    maxDepth: 5,
    maxScreens: 100,
    perScreenTaps: 10,
    timeBudgetMs: 1_000_000,
    now: () => 0, // frozen clock => time budget never trips; keeps tests deterministic
    ...over,
  };
}

function screenLabels(steps: StepResult[]): string[] {
  return steps.filter((s) => s.action.startsWith('screen: ')).map((s) => s.action.slice('screen: '.length));
}

test('crawls reachable screens, dedupes, and never taps a destructive control', async () => {
  const probe = new FakeProbe(structuredClone(GRAPH), 'home');
  const steps: StepResult[] = [];
  const outcome = await crawl(probe, opts(), (s) => steps.push(s));

  assert.equal(outcome.screensVisited, 4); // home, account, profile, search — NOT pay
  assert.equal(outcome.problems, 0);
  assert.equal(outcome.stoppedReason, 'completed');
  assert.equal(probe.tapped.includes('Subscribe Now'), false);
  assert.ok(probe.tapped.includes('tab_account'));
  assert.ok(probe.tapped.includes('open_profile'));

  const labels = screenLabels(steps);
  for (const l of ['Home', 'Account', 'Profile', 'Search']) assert.ok(labels.includes(l), 'missing screen ' + l);
  assert.equal(labels.includes('Payment'), false);
  assert.ok(steps.filter((s) => s.action.startsWith('screen:')).every((s) => Boolean(s.screenshotPath)));
});

test('respects the screen budget', async () => {
  const probe = new FakeProbe(structuredClone(GRAPH), 'home');
  const outcome = await crawl(probe, opts({ maxScreens: 2 }), () => {});
  assert.equal(outcome.screensVisited, 2);
  assert.equal(outcome.stoppedReason, 'budget');
});

test('records an unhealthy screen as a failing step', async () => {
  const broken = structuredClone(GRAPH);
  broken.account!.ok = false;
  const probe = new FakeProbe(broken, 'home');
  const steps: StepResult[] = [];
  const outcome = await crawl(probe, opts(), (s) => steps.push(s));
  assert.ok(outcome.problems >= 1);
  const bad = steps.find((s) => !s.ok);
  assert.ok(bad);
  assert.match(bad!.action, /^screen: Account/);
});

test('an already-aborted signal stops before visiting anything', async () => {
  const probe = new FakeProbe(structuredClone(GRAPH), 'home');
  const outcome = await crawl(probe, opts({ signal: { aborted: true } }), () => {});
  assert.equal(outcome.screensVisited, 0);
  assert.equal(outcome.stoppedReason, 'aborted');
});

test('never taps an unlabeled control (cannot be vetted by the denylist)', async () => {
  const graph: Record<string, Screen> = {
    home: { sig: 'home', label: 'Home', ok: true, links: [{ label: '', to: 'mystery' }, { label: 'tab_account', to: 'account' }] },
    account: { sig: 'account', label: 'Account', ok: true, links: [] },
    mystery: { sig: 'mystery', label: 'Mystery', ok: true, links: [] },
  };
  const probe = new FakeProbe(graph, 'home');
  const steps: StepResult[] = [];
  const outcome = await crawl(probe, opts(), (s) => steps.push(s));
  assert.equal(probe.tapped.includes(''), false);
  assert.ok(probe.tapped.includes('tab_account'));
  assert.equal(screenLabels(steps).includes('Mystery'), false);
  assert.equal(outcome.screensVisited, 2); // home + account, NOT mystery
});

test('records an immersive (leaf) screen but never taps into it', async () => {
  const graph: Record<string, Screen> = {
    home: { sig: 'home', label: 'Home', ok: true, links: [{ label: 'open_player', to: 'player' }] },
    player: { sig: 'player', label: 'Player', ok: true, leaf: true, links: [{ label: 'deep', to: 'deepScreen' }] },
    deepScreen: { sig: 'deepScreen', label: 'Deep', ok: true, links: [] },
  };
  const probe = new FakeProbe(graph, 'home');
  const steps: StepResult[] = [];
  const outcome = await crawl(probe, opts(), (s) => steps.push(s));
  const labels = screenLabels(steps);
  assert.ok(labels.includes('Player')); // recorded
  assert.equal(probe.tapped.includes('deep'), false); // but not tapped into
  assert.equal(labels.includes('Deep'), false);
  assert.equal(outcome.screensVisited, 2); // home + player, NOT deepScreen
});

test('reset-and-replay reaches every sibling even when one branch ends in a player', async () => {
  // Branch A dead-ends in a leaf player; without reset-between-branches, sibling
  // B would be unreachable. Reset to root + replay must still reach B.
  const graph: Record<string, Screen> = {
    home: { sig: 'home', label: 'Home', ok: true, links: [{ label: 'A', to: 'playerA' }, { label: 'B', to: 'screenB' }] },
    playerA: { sig: 'playerA', label: 'PlayerA', ok: true, leaf: true, links: [] },
    screenB: { sig: 'screenB', label: 'ScreenB', ok: true, links: [] },
  };
  const probe = new FakeProbe(graph, 'home');
  const steps: StepResult[] = [];
  const outcome = await crawl(probe, opts(), (s) => steps.push(s));
  const labels = screenLabels(steps);
  assert.ok(labels.includes('PlayerA'));
  assert.ok(labels.includes('ScreenB'), 'sibling B must be reachable after a leaf branch via reset+replay');
  assert.equal(outcome.screensVisited, 3);
  assert.ok(probe.resets > 0); // it genuinely reset to recover
});
