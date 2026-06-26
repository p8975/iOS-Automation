import type { Account } from '../types.ts';
import type { OtpProvider, OtpConfig } from './otpProvider.ts';
import { RunnerError } from '../types.ts';

/**
 * Pulls the latest OTP for a test number from a backend test-only endpoint
 * (e.g. GET /test/otp?phone=...). Use when QA/backend exposes such a hook.
 * Expects a JSON body shaped like { "code": "123456" }.
 */
export class BackendEndpointProvider implements OtpProvider {
  readonly name = 'backend_endpoint';
  private readonly config: OtpConfig;
  constructor(config: OtpConfig) {
    if (!config.backendEndpoint)
      throw new RunnerError('backend_endpoint strategy selected but `backendEndpoint` config missing');
    this.config = config;
  }

  async getCode(account: Account): Promise<string> {
    const { url, apiKey, pollTimeoutMs = 30_000 } = this.config.backendEndpoint!;
    const target = `${url}${url.includes('?') ? '&' : '?'}phone=${encodeURIComponent(account.phone)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const deadline = Date.now() + pollTimeoutMs;
    let lastErr = 'no code returned';
    while (Date.now() < deadline) {
      const res = await fetch(target, { headers });
      if (res.ok) {
        const body = (await res.json()) as { code?: string | number };
        if (body.code != null) return String(body.code);
        lastErr = 'endpoint responded without a `code` field';
      } else {
        lastErr = `endpoint ${res.status}`;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new RunnerError(`backend_endpoint: could not retrieve OTP for ${account.phone}: ${lastErr}`);
  }
}
