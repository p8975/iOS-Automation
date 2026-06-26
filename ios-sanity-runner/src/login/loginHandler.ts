import type { Driver } from '../session/appiumSession.ts';
import type { Account } from '../types.ts';
import type { OtpProvider } from '../otp/otpProvider.ts';
import type { LoginLocators } from '../config/config.ts';
import { resolveLocator } from '../locators/locatorEngine.ts';
import { RunnerError } from '../types.ts';

/**
 * Drives the OTP/SMS login: enter phone -> request code -> fetch code via the
 * pluggable OtpProvider -> enter code -> submit. The OTP retrieval is fully
 * decoupled (bypass / Twilio / backend) behind `OtpProvider`.
 */
export class LoginHandler {
  private readonly driver: Driver;
  private readonly locators: LoginLocators;
  private readonly otp: OtpProvider;

  constructor(driver: Driver, locators: LoginLocators, otp: OtpProvider) {
    this.driver = driver;
    this.locators = locators;
    this.otp = otp;
  }

  async login(account: Account, timeoutMs = 20_000): Promise<void> {
    await this.fill(this.locators.phoneField, account.phone, timeoutMs);
    await this.tap(this.locators.continueButton, timeoutMs);

    const code = await this.otp.getCode(account);
    await this.fill(this.locators.otpField, code, timeoutMs);
    await this.tap(this.locators.submitButton, timeoutMs);

    if (this.locators.successMarker) {
      const loc = resolveLocator(this.locators.successMarker);
      if (loc.selector) {
        const el = await this.driver.$(loc.selector);
        await el.waitForExist({ timeout: timeoutMs });
      }
    }
  }

  private async fill(spec: LoginLocators['phoneField'], value: string, timeoutMs: number): Promise<void> {
    const loc = resolveLocator(spec);
    if (!loc.selector) throw new RunnerError('login field must be an element locator, not coordinates');
    const el = await this.driver.$(loc.selector);
    await el.waitForExist({ timeout: timeoutMs });
    await el.setValue(value);
  }

  private async tap(spec: LoginLocators['continueButton'], timeoutMs: number): Promise<void> {
    const loc = resolveLocator(spec);
    if (!loc.selector) throw new RunnerError('login button must be an element locator, not coordinates');
    const el = await this.driver.$(loc.selector);
    await el.waitForExist({ timeout: timeoutMs });
    await el.click();
  }
}
