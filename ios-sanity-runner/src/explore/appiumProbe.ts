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
// STAGE is a Hindi app, so English-only markers would let a Hindi error/empty
// screen pass as healthy. Matched against the raw (not lower-cased) source.
const HINDI_ERROR_MARKERS = ['कुछ गलत हो गया', 'कुछ गड़बड़', 'फिर से कोशिश', 'पुनः प्रयास', 'दोबारा कोशिश', 'इंटरनेट कनेक्शन', 'नो इंटरनेट'];
const MAX_ELEMENTS = 40;

export class AppiumProbe implements UiProbe {
  readonly #driver: Driver;
  readonly #save: (name: string, base64: string) => Promise<string | undefined>;
  readonly #bundleId: string;
  readonly #homeControl: string | undefined;
  readonly #homeMarkers: readonly string[];

  constructor(
    driver: Driver,
    save: (name: string, base64: string) => Promise<string | undefined>,
    bundleId: string,
    homeControl?: string,
    homeMarkers: readonly string[] = [],
  ) {
    this.#driver = driver;
    this.#save = save;
    this.#bundleId = bundleId;
    this.#homeControl = homeControl;
    this.#homeMarkers = homeMarkers;
  }

  /** Close a modal/overlay by a common affordance (Dismiss / Close / Back / ✕).
   *  Returns true if it clicked one. Read-only-safe: a close/back never mutates
   *  account state, and reset() only ever wants to move TOWARDS the root. */
  async #tapClose(): Promise<boolean> {
    const names = ['Dismiss', 'Close', 'बंद करें', 'बंद', 'वापस जाएं', 'वापस', 'Back', 'Cancel', 'रद्द करें', '✕', '×'];
    for (const n of names) {
      try {
        const b = await this.#driver.$("-ios predicate string:name == '" + n.replace(/'/g, "\\'") + "'");
        if (await b.isExisting()) {
          await b.click();
          return true;
        }
      } catch {
        /* try the next affordance */
      }
    }
    return false;
  }

  /** iOS back: a left-edge drag in portrait; a plain right-swipe out of a landscape player. */
  async #backGesture(): Promise<void> {
    let landscape = false;
    try {
      landscape = String((await this.#driver.getOrientation()) ?? '').toUpperCase().startsWith('LANDSCAPE');
    } catch {
      /* assume portrait */
    }
    try {
      if (landscape) {
        await this.#driver.execute('mobile: swipe', { direction: 'right' });
      } else {
        const rect = (await this.#driver.getWindowRect()) as { width: number; height: number };
        const midY = Math.floor(rect.height / 2);
        await this.#driver.execute('mobile: dragFromToForDuration', {
          duration: 0.3, fromX: 3, fromY: midY, toX: Math.floor(rect.width * 0.9), toY: midY,
        });
      }
    } catch {
      /* best-effort — re-check on the next loop */
    }
  }

  async signature(): Promise<string> {
    try {
      return screenSignature(await this.#driver.getPageSource());
    } catch {
      return 'unavailable';
    }
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
    // A native system alert modally blocks the app — the surest "not actually on a
    // content screen" signal, and the exact false-pass we hit (a permission popup
    // counted as a healthy home, because its buttons live in SpringBoard, invisible
    // to the app page source below). autoAcceptAlerts usually clears these first;
    // this is the backstop for any alert it doesn't auto-handle.
    try {
      const btns = (await this.#driver.execute('mobile: alert', { action: 'getButtons' })) as unknown as string[];
      if (Array.isArray(btns) && btns.length > 0) {
        return { ok: false, problem: 'a native system alert is blocking the screen (' + btns.join(' / ') + ')' };
      }
    } catch {
      /* no alert open — healthy so far */
    }
    let src: string;
    try {
      src = await this.#driver.getPageSource();
    } catch (err) {
      return { ok: false, problem: 'app/session not responding: ' + (err instanceof Error ? err.message : String(err)) };
    }
    // An immersive landscape screen (a media player) legitimately carries little
    // labelled content, so the "no meaningful content" check is skipped for it.
    let immersive = false;
    try {
      immersive = String((await this.#driver.getOrientation()) ?? '').toUpperCase().startsWith('LANDSCAPE');
    } catch {
      /* assume portrait */
    }
    return assessScreen(src, immersive);
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
    // preserves the signed-in state.
    try {
      await this.#driver.execute('mobile: activateApp', { bundleId: this.#bundleId });
    } catch {
      /* best-effort */
    }

    // Return to the app ROOT. activateApp only foregrounds — it does NOT leave the
    // current screen — and full-screen screens (search, a detail page) carry no
    // bottom-nav home tab to tap, so the old homeControl click stranded the crawl
    // there and every sibling tap then failed. Back out toward home instead.
    // A Flutter MODAL (e.g. the "श्रेणियाँ" categories sheet) ignores the back
    // gesture, so each round we first try to CLOSE an overlay by its affordance
    // (Dismiss / Close / Back), then fall back to the back gesture. Stop as soon as
    // a home marker shows OR the last action changed nothing (at root / stuck):
    // that self-limit is essential — blindly swiping on a screen the gesture can't
    // leave scrolls the home chips out of view and breaks every replay tap after.
    let prev = '';
    for (let i = 0; i < 8; i++) {
      let src = '';
      try {
        src = await this.#driver.getPageSource();
      } catch {
        /* best-effort — act anyway */
      }
      if (this.#homeMarkers.some((m) => src.includes(m))) break; // reached home
      if (src !== '' && src === prev) break; // last action changed nothing → stop, don't thrash
      prev = src;
      if (!(await this.#tapClose())) await this.#backGesture();
      try {
        await this.#driver.pause(700);
      } catch {
        /* ignore */
      }
    }

    // If a home control is configured and present, tap it to normalize onto the
    // Home tab (backing out may land on a different tab). Best-effort; matches by
    // name OR label since some tabs expose only one.
    if (this.#homeControl) {
      try {
        const esc = this.#homeControl.replace(/'/g, "\\'");
        const el = await this.#driver.$("-ios predicate string:name == '" + esc + "' OR label == '" + esc + "'");
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

/**
 * Judge a page-source snapshot's health. Pure (no driver) so it is unit-tested
 * directly, mirroring {@link parseInteractive}. The alert-present and
 * orientation checks stay in {@link AppiumProbe.health} (they need the driver);
 * this covers the source-derived signals that flag a false pass:
 *   - an error state (English or Hindi markers), or
 *   - an effectively blank screen (almost no elements), or
 *   - a rendered-but-empty screen: raw node counts stay high on a stuck Flutter
 *     tree, so also require a minimum of LABELLED nodes (real content/controls).
 * `immersive` (a landscape player) skips the content check — such screens
 * legitimately carry little labelled content.
 */
export function assessScreen(src: string, immersive = false): ScreenHealth {
  const lc = src.toLowerCase();
  const marker = ERROR_MARKERS.find((m) => lc.includes(m)) ?? HINDI_ERROR_MARKERS.find((m) => src.includes(m));
  if (marker) return { ok: false, problem: 'error state on screen ("' + marker + '")' };
  const elementCount = (src.match(/<XCUIElementType/g) ?? []).length;
  if (elementCount < 3) return { ok: false, problem: 'screen appears blank (' + elementCount + ' elements)' };
  if (!immersive) {
    const labelled = (src.match(/\b(?:name|label)="[^"]+"/g) ?? []).length;
    if (labelled < 2) return { ok: false, problem: 'screen shows no meaningful content (' + labelled + ' labelled elements)' };
  }
  return { ok: true };
}

/**
 * A screen's de-duplication signature: the SORTED MULTISET of its elements'
 * `type:name` (name falls back to label), hashed. Pure, so it is unit-tested.
 *
 * Deliberately identity-based, not structure-based: hashing the raw XML made
 * re-visits of the SAME screen hash differently because of transient attributes
 * (focus/selection state, element ordering, volatile wrapper nodes) — inflating
 * the screen count with near-duplicates. Keying on the set of named elements
 * ignores that noise while KEEPING content names, so genuinely different pages
 * (e.g. Movies vs Shows, which carry different titles) stay distinct.
 */
export function screenSignature(xml: string): string {
  const re = /<XCUIElementType(\w+)([^>]*)>/g;
  const tokens: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const type = m[1] ?? '';
    const raw = attr(m[2] ?? '', 'name') ?? attr(m[2] ?? '', 'label') ?? '';
    const text = decodeXml(raw).trim();
    if (text) tokens.push(type + ':' + text); // unnamed wrapper nodes carry no identity — skip
  }
  tokens.sort();
  return hash(tokens.join('|'));
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
    const value = decodeXml(rawName || rawLabel); // the element's ACTUAL attribute value
    const text = value.trim(); // display label (trimmed)
    if (!text) continue; // unidentifiable → the crawler would skip it anyway
    const key = type + '|' + field + '|' + text;
    if (seen.has(key)) continue;
    seen.add(key);
    // Match the predicate against the UNTRIMMED value: some STAGE controls carry a
    // leading/trailing space in their name (e.g. " माइक्रो ड्रामाज़- 2 मिनट एपिसोड"),
    // and an exact `==` on the trimmed text would never resolve them at tap time —
    // the control shows up in the inventory but every tap times out.
    const esc = value.replace(/'/g, "\\'");
    out.push({ label: text, selector: `-ios predicate string:type == 'XCUIElementType${type}' AND ${field} == '${esc}'` });
  }
  return out;
}
