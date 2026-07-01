/**
 * The real {@link UiProbe}, backed by a live WebdriverIO/xcuitest driver. This
 * is the only exploration module that touches Appium, so it runs only against a
 * device/simulator — the crawl logic that uses it is tested separately with a
 * fake probe.
 */
import type { Driver } from '../session/appiumSession.ts';
import type { ScreenHealth, UiElement, UiProbe } from './crawler.ts';

// Classic natively-accessible control types. STAGE is Flutter, which instead
// renders tappables as Image/Other nodes marked accessible="true" — so the
// parser also accepts ANY element carrying accessible="true" (see parseInteractive).
const INTERACTIVE_TYPES = [
  'Button', 'Cell', 'Link', 'SwitchToggle', 'Switch', 'TabBarButton', 'MenuItem',
  'TextField', 'SecureTextField', 'SearchField', 'Image',
];
const ERROR_MARKERS = ['something went wrong', 'went wrong', 'try again later', 'error occurred', 'unexpected error', 'no internet'];
const MAX_ELEMENTS = 40;

export class AppiumProbe implements UiProbe {
  readonly #driver: Driver;
  readonly #save: (name: string, base64: string) => Promise<string | undefined>;
  readonly #bundleId: string;
  readonly #homeControl: string | undefined;

  constructor(
    driver: Driver,
    save: (name: string, base64: string) => Promise<string | undefined>,
    bundleId: string,
    homeControl?: string,
  ) {
    this.#driver = driver;
    this.#save = save;
    this.#bundleId = bundleId;
    this.#homeControl = homeControl;
  }

  async signature(): Promise<string> {
    let src: string;
    try {
      src = await this.#driver.getPageSource();
    } catch {
      return 'unavailable';
    }
    // Drop volatile attributes (coords/sizes/values/indices) so the signature
    // reflects screen STRUCTURE, not transient state, then hash it.
    const norm = src.replace(/\b(x|y|width|height|index|value)="[^"]*"/g, '').replace(/\s+/g, ' ');
    return hash(norm);
  }

  async describe(): Promise<string> {
    try {
      const nav = await this.#driver.$('-ios class chain:**/XCUIElementTypeNavigationBar[1]');
      if (await nav.isExisting()) {
        const name = await nav.getAttribute('name').catch(() => '');
        if (name) return String(name);
      }
    } catch {
      /* fall through */
    }
    return 'screen';
  }

  async health(): Promise<ScreenHealth> {
    let src: string;
    try {
      src = await this.#driver.getPageSource();
    } catch (err) {
      return { ok: false, problem: 'app/session not responding: ' + (err instanceof Error ? err.message : String(err)) };
    }
    const lc = src.toLowerCase();
    const marker = ERROR_MARKERS.find((m) => lc.includes(m));
    if (marker) return { ok: false, problem: 'error state on screen ("' + marker + '")' };
    const elementCount = (src.match(/<XCUIElementType/g) ?? []).length;
    if (elementCount < 3) return { ok: false, problem: 'screen appears blank (' + elementCount + ' elements)' };
    return { ok: true };
  }

  async interactive(): Promise<UiElement[]> {
    let xml: string;
    try {
      xml = await this.#driver.getPageSource();
    } catch {
      return [];
    }
    // Enumerate from ONE page-source snapshot — zero per-element WDIO calls — so
    // a churning Flutter tree can't trigger a stale-element storm during
    // discovery. Each control carries a predicate selector, NOT a live handle.
    return parseInteractive(xml).map((c) => ({ label: c.label, handle: c.selector }));
  }

  async tap(el: UiElement): Promise<void> {
    // Re-find the control FRESH from its stable predicate immediately before the
    // click. We never click a cached handle: by tap time the tree has usually
    // rebuilt and a cached handle would be stale (the failure mode on STAGE).
    const e = await this.#driver.$(el.handle as string);
    await e.waitForExist({ timeout: 3000 });
    await e.click();
  }

  /**
   * Clear native SYSTEM permission alerts (SpringBoard), choosing the button that
   * lets QA keep moving into content. Generic by design: it reads whatever buttons
   * the current alert actually has (`mobile: alert` reaches SpringBoard alerts the
   * app page source can't see) and clicks the most "proceed" one — so a brand-new
   * permission prompt it has never been told about is still handled.
   *
   * A fresh launch (and the beat right after login) can STACK several alerts, and
   * some — notably STAGE's location prompt — appear a beat LATE, so we poll a few
   * rounds and wait briefly for a late arrival before giving up.
   */
  async #dismissSystemAlerts(): Promise<void> {
    // Preference order: options that keep the app advancing into real content.
    // "Ask App Not to Track" is the ATT decline (still proceeds); the location
    // prompt's "Allow While Using App" lets regional content load.
    const PREFER = [
      'Allow While Using App', 'Allow Once', 'Allow', 'OK', 'Continue',
      'Ask App Not to Track', "Don't Allow",
    ];
    const buttons = async (): Promise<string[] | undefined> => {
      try {
        return (await this.#driver.execute('mobile: alert', { action: 'getButtons' })) as unknown as string[];
      } catch {
        return undefined; // no alert currently open
      }
    };
    for (let round = 0; round < 6; round++) {
      let names = await buttons();
      if (!names || names.length === 0) {
        // Nothing open right now — wait once for a late-appearing alert, re-check.
        await this.#driver.pause(500);
        names = await buttons();
        if (!names || names.length === 0) return; // genuinely none
      }
      const choice = PREFER.find((p) => names.includes(p)) ?? names[names.length - 1];
      try {
        await this.#driver.execute('mobile: alert', { action: 'accept', buttonLabel: choice });
      } catch {
        try {
          await this.#driver.execute('mobile: alert', { action: 'accept' });
        } catch {
          return; // couldn't act on it — leave for the next pass
        }
      }
      await this.#driver.pause(700);
    }
  }

  /**
   * Dismiss blocking interstitials that sit over the app's own screens so the
   * next action can proceed:
   *   1) native iOS permission alerts (ATT / location / notifications / …) —
   *      cleared generically by {@link #dismissSystemAlerts};
   *   2) the Flutter "अपनी बोली चुनें" (choose your dialect) / culture popup —
   *      tap its close ("Dismiss") or continue ("आगे बढे") control.
   * A dialect OPTION is never tapped (that would change the selected culture);
   * only the close/continue affordance is used, leaving the selection intact.
   * Best-effort and fast: any failure is swallowed so it can run every step.
   */
  async dismissInterstitials(): Promise<void> {
    // 1) Native SYSTEM permission alerts (ATT tracking, location, notifications,
    //    camera, …). They belong to SpringBoard, not the app tree, so an
    //    app-scoped element query misses them — only the alert API reaches them.
    await this.#dismissSystemAlerts();

    // 2) Flutter dialect/culture popup — only if its title is on screen.
    // Try a few times: tap a close control, re-check the source, repeat until the
    // popup is gone. "आगे बढे" (continue, confirms the already-selected culture)
    // reliably closes it; the "Dismiss" X often does NOT, so it is the LAST resort.
    for (let attempt = 0; attempt < 3; attempt++) {
      let src: string;
      try {
        src = await this.#driver.getPageSource();
      } catch {
        return;
      }
      if (!/अपनी बोली चुनें|बोली चुनें|Choose your dialect/.test(src)) return; // gone
      let tapped = false;
      for (const name of ['आगे बढे', 'आगे बढ़ें', 'जारी रखें', 'Continue', 'Dismiss']) {
        try {
          const b = await this.#driver.$("-ios predicate string:name == '" + name + "'");
          if (await b.isExisting()) {
            await b.click();
            await this.#driver.pause(1200);
            tapped = true;
            break;
          }
        } catch {
          /* try the next control */
        }
      }
      if (!tapped) return; // no known close control on screen — nothing more to do
    }
  }

  async isLeaf(): Promise<boolean> {
    // A content app rotates to landscape for its media player; treat any
    // landscape screen as an immersive/terminal leaf (record it, don't tap in).
    try {
      const o = String((await this.#driver.getOrientation()) ?? '').toUpperCase();
      return o.startsWith('LANDSCAPE');
    } catch {
      return false;
    }
  }

  async reset(): Promise<void> {
    // WARM resume only — foreground the app WITHOUT terminating it. A cold
    // relaunch (terminateApp) drops STAGE to its login/onboarding gate; activate
    // preserves the signed-in state. Returning to root is then best-effort and
    // relaunch-free: pop a fullscreen/landscape view (e.g. a player) with the
    // iOS back-swipe, then tap the app's home control if one is configured.
    try {
      await this.#driver.execute('mobile: activateApp', { bundleId: this.#bundleId });
    } catch {
      /* best-effort */
    }
    for (let i = 0; i < 3; i++) {
      let landscape = false;
      try {
        landscape = String((await this.#driver.getOrientation()) ?? '').toUpperCase().startsWith('LANDSCAPE');
      } catch {
        /* ignore */
      }
      if (!landscape) break;
      try {
        await this.#driver.execute('mobile: swipe', { direction: 'right' });
      } catch {
        /* best-effort */
      }
      try {
        await this.#driver.pause(500);
      } catch {
        /* ignore */
      }
    }
    if (this.#homeControl) {
      try {
        const esc = this.#homeControl.replace(/'/g, "\\'");
        const el = await this.#driver.$("-ios predicate string:name == '" + esc + "'");
        if (await el.isExisting()) await el.click();
      } catch {
        /* home control not present here — best-effort */
      }
    }
    try {
      await this.#driver.pause(800); // let the screen settle before replay
    } catch {
      /* the next re-find waits anyway */
    }
  }

  async capture(name: string): Promise<string | undefined> {
    try {
      return await this.#save(name, await this.#driver.takeScreenshot());
    } catch {
      return undefined;
    }
  }
}

/** djb2 — small, dependency-free, good enough for screen de-duplication. */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export interface ParsedControl {
  label: string;
  /** A predicate selector that re-finds this control in the CURRENT tree. */
  selector: string;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp('\\b' + name + '="([^"]*)"').exec(attrs);
  return m ? m[1] : undefined;
}

/** Decode the XML entities XCUITest page source uses, so the re-find predicate matches the real element name. */
function decodeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Parse interactive controls from an XCUITest page-source snapshot. Pure (no
 * driver) so it is unit-tested directly. For each visible, enabled, identifiable
 * control of an interactive type it returns a stable predicate selector that
 * re-finds it at tap time — so the crawler never holds a cached element handle.
 * The denylist is NOT applied here (the crawler vets labels); this just lists
 * what's tappable.
 */
export function parseInteractive(
  xml: string,
  types: readonly string[] = INTERACTIVE_TYPES,
  max = MAX_ELEMENTS,
): ParsedControl[] {
  const out: ParsedControl[] = [];
  const seen = new Set<string>();
  const re = /<XCUIElementType(\w+)([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && out.length < max) {
    const type = m[1] ?? '';
    const attrs = m[2] ?? '';
    // A candidate is a classic interactive type OR any element Flutter marked
    // accessible="true" (its semantics marker for a tappable/meaningful node).
    if (!types.includes(type) && attr(attrs, 'accessible') !== 'true') continue;
    if (attr(attrs, 'visible') === 'false') continue;
    if (attr(attrs, 'enabled') === 'false') continue;
    const rawName = attr(attrs, 'name') ?? '';
    const rawLabel = attr(attrs, 'label') ?? '';
    const field = rawName ? 'name' : 'label';
    const raw = rawName || rawLabel;
    const text = decodeXml(raw).trim();
    if (!text) continue; // unidentifiable → the crawler would skip it anyway
    const key = type + '|' + field + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);
    const esc = text.replace(/'/g, "\\'");
    out.push({ label: text, selector: `-ios predicate string:type == 'XCUIElementType${type}' AND ${field} == '${esc}'` });
  }
  return out;
}
