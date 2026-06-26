import type { Account } from '../types.ts';
import type { OtpProvider, OtpConfig } from './otpProvider.ts';
import { RunnerError } from '../types.ts';

/**
 * DEFAULT strategy. Returns a fixed/bypass code for test accounts — the
 * per-account `bypassCode` wins, else the global `bypassCode` from config.
 * Simplest and most deterministic; ideal for a sanity gate when the backend
 * accepts a fixed code for test numbers.
 */
export class BypassCodeProvider implements OtpProvider {
  readonly name = 'bypass';
  private readonly config: OtpConfig;
  constructor(config: OtpConfig) {
    this.config = config;
  }

  async getCode(account: Account): Promise<string> {
    const code = account.bypassCode ?? this.config.bypassCode;
    if (!code) {
      throw new RunnerError(
        `bypass OTP strategy selected but no bypass_code configured (global or for ${account.phone})`,
      );
    }
    return code;
  }
}
