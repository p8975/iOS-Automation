import type { OtpProvider, OtpConfig } from './otpProvider.ts';
import { BypassCodeProvider } from './bypassProvider.ts';
import { TwilioProvider } from './twilioProvider.ts';
import { BackendEndpointProvider } from './backendEndpointProvider.ts';
import { RunnerError } from '../types.ts';

export type { OtpProvider, OtpConfig, OtpStrategy } from './otpProvider.ts';
export { BypassCodeProvider } from './bypassProvider.ts';
export { TwilioProvider } from './twilioProvider.ts';
export { BackendEndpointProvider } from './backendEndpointProvider.ts';

/**
 * Factory: selects the OTP strategy from config. This is the single switch
 * that makes swapping bypass <-> SMS <-> backend a config-only change.
 */
export function createOtpProvider(config: OtpConfig): OtpProvider {
  switch (config.defaultStrategy) {
    case 'bypass':
      return new BypassCodeProvider(config);
    case 'twilio':
      return new TwilioProvider(config);
    case 'backend_endpoint':
      return new BackendEndpointProvider(config);
    default:
      throw new RunnerError(`unknown OTP strategy: ${String(config.defaultStrategy)}`);
  }
}
