import { remote } from 'webdriverio';
import type { RunnerConfig } from '../config/config.ts';
import type { ResolvedDevice, DeviceManager } from '../devices/deviceManager.ts';
import { RunnerError } from '../types.ts';

/** Minimal surface the action runner needs from a live driver session. */
export type Driver = WebdriverIO.Browser;

/**
 * Wraps a WebdriverIO session against the Appium xcuitest driver. Owns session
 * lifecycle and exposes the raw driver for the action runner. The same wrapper
 * serves simulator and device — only the capabilities differ (supplied by the
 * DeviceManager).
 */
export class AppiumSession {
  private driver: Driver | null = null;
  private readonly config: RunnerConfig;
  private readonly manager: DeviceManager;
  private readonly device: ResolvedDevice;

  constructor(config: RunnerConfig, manager: DeviceManager, device: ResolvedDevice) {
    this.config = config;
    this.manager = manager;
    this.device = device;
  }

  get raw(): Driver {
    if (!this.driver) throw new RunnerError('session not started');
    return this.driver;
  }

  async start(): Promise<void> {
    const capabilities: Record<string, unknown> = {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:bundleId': this.config.bundleId,
      'appium:noReset': true,
      // WDA continuously auto-accepts native permission alerts (ATT / location /
      // notifications / …) the instant they appear — including the ones STAGE
      // fires ASYNCHRONOUSLY a beat after login/home, which a polled dismiss
      // always races. dismissInterstitials() stays as a backstop + for the
      // in-app (Flutter) dialect popup, which is not a system alert.
      'appium:autoAcceptAlerts': true,
      ...this.manager.capabilities(this.device),
    };
    // Real-device WDA signing — ignored by the Simulator.
    if (this.device.kind === 'device' && this.config.wda) {
      Object.assign(capabilities, {
        'appium:updatedWDABundleId': this.config.wda.updatedWDABundleId,
        'appium:xcodeOrgId': this.config.wda.xcodeOrgId,
        'appium:xcodeSigningId': this.config.wda.xcodeSigningId ?? 'iPhone Developer',
      });
    }

    this.driver = await remote({
      hostname: this.config.appium.hostname,
      port: this.config.appium.port,
      path: this.config.appium.path,
      logLevel: 'warn',
      connectionRetryCount: 0, // a sanity gate should fail fast, not retry a dead server
      capabilities,
    });
  }

  /** Full accessibility/page-source XML for the locator engine + debugging. */
  async pageSource(): Promise<string> {
    return this.raw.getPageSource();
  }

  async screenshot(): Promise<string> {
    return this.raw.takeScreenshot(); // base64 PNG
  }

  async stop(): Promise<void> {
    if (this.driver) {
      await this.driver.deleteSession();
      this.driver = null;
    }
  }
}
