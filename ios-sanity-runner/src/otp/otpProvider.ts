import type { Account } from '../types.ts';

/**
 * The OTP retrieval strategy is pluggable behind this one interface. Swapping
 * strategies (bypass code -> SMS gateway -> backend endpoint) is a CONFIG
 * change, never a code change — see `createOtpProvider`.
 */
export interface OtpProvider {
  readonly name: string;
  /** Return the OTP for the given account, or throw if it cannot be obtained. */
  getCode(account: Account): Promise<string>;
}

export type OtpStrategy = 'bypass' | 'twilio' | 'backend_endpoint';

export interface OtpConfig {
  defaultStrategy: OtpStrategy;
  /** bypass: fixed code used when an account has no per-account override. */
  bypassCode?: string;
  /** twilio: credentials for reading the inbound SMS for a test number. */
  twilio?: { accountSid: string; authToken: string; pollTimeoutMs?: number };
  /** backend_endpoint: a test-only endpoint that returns the latest code. */
  backendEndpoint?: { url: string; apiKey?: string; pollTimeoutMs?: number };
}
