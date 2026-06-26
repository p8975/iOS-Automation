import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';
import type { OtpConfig } from '../otp/otpProvider.ts';
import type { Target } from '../types.ts';
import type { LocatorSpec } from '../suite/schema.ts';

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
  /** Locators for the OTP login screen (app-specific). */
  login?: LoginLocators;
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
