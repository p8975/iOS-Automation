import type { Account } from '../types.ts';
import type { OtpProvider, OtpConfig } from './otpProvider.ts';
import { RunnerError } from '../types.ts';

const OTP_REGEX = /\b(\d{4,8})\b/;

/**
 * Reads the most recent inbound SMS for the test number from Twilio and
 * extracts the numeric code. Use when test numbers receive REAL SMS.
 *
 * Implemented against Twilio's REST API with no SDK dependency (plain fetch),
 * so the module stays dependency-light. Polls until a fresh code arrives.
 */
export class TwilioProvider implements OtpProvider {
  readonly name = 'twilio';
  private readonly config: OtpConfig;
  constructor(config: OtpConfig) {
    if (!config.twilio) throw new RunnerError('twilio strategy selected but `twilio` config missing');
    this.config = config;
  }

  async getCode(account: Account): Promise<string> {
    const { accountSid, authToken, pollTimeoutMs = 30_000 } = this.config.twilio!;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const url =
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json` +
      `?To=${encodeURIComponent(account.phone)}&PageSize=5`;

    const deadline = Date.now() + pollTimeoutMs;
    let lastErr = 'no SMS received';
    while (Date.now() < deadline) {
      const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
      if (res.ok) {
        const body = (await res.json()) as { messages?: Array<{ body?: string }> };
        for (const msg of body.messages ?? []) {
          const m = msg.body?.match(OTP_REGEX);
          if (m?.[1]) return m[1];
        }
        lastErr = 'SMS present but no numeric code matched';
      } else {
        lastErr = `Twilio API ${res.status}`;
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }
    throw new RunnerError(`twilio: could not retrieve OTP for ${account.phone}: ${lastErr}`);
  }
}
