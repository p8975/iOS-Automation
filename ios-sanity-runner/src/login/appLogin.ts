/**
 * Keyboard-based auto-login for a Flutter app (STAGE), where text fields don't
 * accept `setValue` and must be typed via the native iOS keyboard. It is
 * idempotent: it inspects the current screen and only does the work that's
 * needed — phone+OTP on the login screen, profile pick on the "who's watching"
 * screen, nothing if already home. Driven entirely by config (no credentials in
 * code). Device-only; validated live rather than unit-tested.
 */
import type { Driver } from '../session/appiumSession.ts';
import { RunnerError } from '../types.ts';

export interface AutoLoginConfig {
  /** Mobile digits typed after the on-screen country code, e.g. "2022123419". */
  phone: string;
  /** OTP digits, e.g. "3419" (a fixed/bypass test code). */
  otp: string;
  /** Accessibility names to try for the login/continue button. */
  loginButtonNames?: string[];
  /** Profile to select on the "who's watching" screen; omit to pick the first. */
  profileName?: string;
  /** Any of these appearing in the page source counts as "home reached". */
  homeMarkers?: string[];
}

export interface AutoLoginResult {
  loggedIn: boolean;
  reachedHome: boolean;
  note: string;
}

const DEFAULT_LOGIN_NAMES = ['Login', 'लॉगिन करें', 'लॉगिन', 'Log in', 'Continue'];
const LOGIN_SCREEN_RE = /मोबाइल नंबर|Mobile Number|अपना फ़ोन नंबर|Enter your phone/;
const PROFILE_SCREEN_RE = /कौन देख रहा है|Who'?s watching/;

/** True if the given page source looks like the app's phone-entry login screen. */
export function isLoginScreen(pageSource: string): boolean {
  return LOGIN_SCREEN_RE.test(pageSource);
}

const esc = (s: string): string => s.replace(/'/g, "\\'");

async function tapKey(d: Driver, ch: string): Promise<void> {
  // The Flutter keyboard re-renders constantly; a key can be transiently absent.
  // Retry (re-find + click) instead of failing the whole login on one miss.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const k = await d.$("-ios predicate string:type == 'XCUIElementTypeKey' AND name == '" + esc(ch) + "'");
      await k.waitForExist({ timeout: 2500 });
      await k.click();
      return;
    } catch (err) {
      lastErr = err;
      await d.pause(500);
    }
  }
  throw new RunnerError('keyboard key "' + ch + '" not found after retries: ' + (lastErr instanceof Error ? lastErr.message : String(lastErr)));
}

async function typeKeys(d: Driver, str: string): Promise<void> {
  for (const ch of str) {
    await tapKey(d, ch);
    await d.pause(150);
  }
}

async function source(d: Driver): Promise<string> {
  try {
    return await d.getPageSource();
  } catch {
    return '';
  }
}

/** Log in (and pick a profile) if needed, returning where we ended up. */
export async function autoLogin(d: Driver, cfg: AutoLoginConfig): Promise<AutoLoginResult> {
  let src = await source(d);

  // 1) Login screen → type phone, tap Login, type OTP (the OTP field auto-focuses).
  if (LOGIN_SCREEN_RE.test(src)) {
    const field = await d.$("-ios predicate string:type == 'XCUIElementTypeTextField'");
    await field.waitForExist({ timeout: 8000 });
    await field.click();
    await d.pause(1200);
    await typeKeys(d, cfg.phone);
    await d.pause(600);

    let tapped = false;
    for (const nm of cfg.loginButtonNames ?? DEFAULT_LOGIN_NAMES) {
      try {
        const b = await d.$("-ios predicate string:name == '" + esc(nm) + "'");
        if (await b.isExisting()) {
          await b.click();
          tapped = true;
          break;
        }
      } catch {
        /* try next name */
      }
    }
    if (!tapped) throw new RunnerError('auto-login: could not find the Login button');

    await d.pause(3500);
    await typeKeys(d, cfg.otp); // OTP keyboard is auto-focused; entry auto-submits
    await d.pause(5000);
    src = await source(d);
  }

  // 2) "Who's watching" → pick a profile.
  if (PROFILE_SCREEN_RE.test(src) || (cfg.profileName ? src.includes(cfg.profileName) : false)) {
    let tapped = false;
    if (cfg.profileName) {
      try {
        const p = await d.$("-ios predicate string:name == '" + esc(cfg.profileName) + "'");
        if (await p.isExisting()) {
          await p.click();
          tapped = true;
        }
      } catch {
        /* fall through */
      }
    }
    if (!tapped) {
      try {
        const imgs = [...(await d.$$("-ios class chain:**/XCUIElementTypeImage"))];
        const first = imgs[0];
        if (first) await first.click();
      } catch {
        /* best-effort */
      }
    }
    await d.pause(4000);
    src = await source(d);
  }

  const stillLogin = LOGIN_SCREEN_RE.test(src);
  const stillProfile = PROFILE_SCREEN_RE.test(src);
  const markers = cfg.homeMarkers ?? ['STAGE'];
  const reachedHome = !stillLogin && !stillProfile && markers.some((m) => src.includes(m));
  const note = stillLogin ? 'still on login screen' : stillProfile ? 'still on profile screen' : 'past login';
  return { loggedIn: !stillLogin, reachedHome, note };
}
