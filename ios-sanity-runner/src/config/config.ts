import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';
import type { OtpConfig } from '../otp/otpProvider.ts';
import type { Target } from '../types.ts';
import type { LocatorSpec } from '../suite/schema.ts';
import type { AutoLoginConfig } from '../login/appLogin.ts';

/** App-specific locators for the OTP login screen. */
export interface LoginLocators {
  phoneField: LocatorSpec;
  continueButton: LocatorSpec;
  otpField: LocatorSpec;
  submitButton: LocatorSpec;
  /** Optional element proving login succeeded (e.g. home_screen_root). */
  successMarker?: LocatorSpec;
}

/** Top-level runner configuration (config/runner.config.yaml). */
export interface RunnerConfig {
  appium: { hostname: string; port: number; path: string };
  /** Bundle id of the app under test. */
  bundleId: string;
  defaultTarget: Target;
  otp: OtpConfig;
  /** WDA signing for real devices (ignored for the Simulator). */
  wda?: {
    updatedWDABundleId?: string;
    xcodeOrgId?: string;
    xcodeSigningId?: string;
  };
  /** How the drift check determines an account's real state. */
  stateBackend?: { statusUrl?: string; apiKey?: string };
  /** Locators for the OTP login screen (app-specific) — used by LoginHandler. */
  login?: LoginLocators;
  /** Keyboard-based auto-login for Flutter apps (typed via the native keyboard);
   *  the exploratory crawl runs this before crawling so it reaches signed-in content. */
  autoLogin?: AutoLoginConfig;
  /** Optional tuning for the autonomous exploratory crawl (safe defaults baked in). */
  explore?: {
    /** Extra denylist substrings, merged conceptually with the built-in safe defaults. */
    deny?: string[];
    maxSteps?: number;
    maxDepth?: number;
    maxScreens?: number;
    perScreenTaps?: number;
    timeBudgetMs?: number;
    /** Accessibility name of the app's "home" control (e.g. a bottom-nav tab). When
     *  set, the warm reset taps it to return to root without relaunching the app. */
    homeControl?: string;
    /** HOME-EXCLUSIVE page-source substrings (e.g. the "My List" nav label). The
     *  warm reset back-swipes until one appears, so pick markers that DON'T also
     *  show on inner screens. Falls back to a fixed number of back-outs if unset. */
    homeMarkers?: string[];
    /** When the run starts on the login screen: true (default) = capture/validate it,
     *  then auto-login and explore the signed-in app; false = validate the login flow
     *  only (do not log in). */
    loginThenContinue?: boolean;
  };
  artifactsDir: string;
}

const DEFAULTS: RunnerConfig = {
  appium: { hostname: '127.0.0.1', port: 4723, path: '/' },
  bundleId: '',
  defaultTarget: 'any',
  otp: { defaultStrategy: 'bypass', bypassCode: '000000' },
  artifactsDir: 'artifacts',
};

/** Load runner config from YAML, layering over sane defaults. */
export function loadRunnerConfig(path: string): RunnerConfig {
  if (!existsSync(path)) return DEFAULTS;
  const raw = (yaml.load(readFileSync(path, 'utf8')) ?? {}) as Record<string, unknown>;
  const otpRaw = (raw.otp ?? {}) as Record<string, unknown>;
  return {
    ...DEFAULTS,
    ...raw,
    appium: { ...DEFAULTS.appium, ...(raw.appium as object) },
    otp: {
      defaultStrategy: (otpRaw.default_strategy as OtpConfig['defaultStrategy']) ?? 'bypass',
      bypassCode: (otpRaw.bypass_code as string) ?? DEFAULTS.otp.bypassCode,
      twilio: otpRaw.twilio as OtpConfig['twilio'],
      backendEndpoint: otpRaw.backend_endpoint as OtpConfig['backendEndpoint'],
    },
  } as RunnerConfig;
}
