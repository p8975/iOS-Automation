import type { Account, UserState } from '../types.ts';
import { AccountDriftError, isUserState } from '../types.ts';
import type { RunnerConfig } from '../config/config.ts';

/**
 * Detects an account's CURRENT user state at runtime. This powers two things:
 *   1. the drift check (declared state must equal real state, else fail loud),
 *   2. runtime branching (`branch: on: detected_user_state`).
 *
 * Strategy is pluggable. The most reliable source is a backend status endpoint;
 * a UI-marker detector is the fallback when no backend hook exists.
 */
export interface StateDetector {
  detect(account: Account): Promise<UserState>;
}

/** Reads the real state from a backend test status endpoint. */
export class BackendStateDetector implements StateDetector {
  private readonly config: RunnerConfig;
  constructor(config: RunnerConfig) {
    this.config = config;
  }

  async detect(account: Account): Promise<UserState> {
    const backend = this.config.stateBackend;
    if (!backend?.statusUrl) {
      throw new AccountDriftError(
        'BackendStateDetector requires stateBackend.statusUrl in runner config',
      );
    }
    const url = `${backend.statusUrl}${backend.statusUrl.includes('?') ? '&' : '?'}phone=${encodeURIComponent(account.phone)}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (backend.apiKey) headers.Authorization = `Bearer ${backend.apiKey}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new AccountDriftError(`state endpoint ${res.status} for ${account.phone}`);
    const body = (await res.json()) as { state?: string };
    if (!body.state || !isUserState(body.state)) {
      throw new AccountDriftError(`state endpoint returned unmapped state "${body.state}"`);
    }
    return body.state;
  }
}

/**
 * DRIFT CHECK: assert the leased account is actually in its declared state.
 * Seeded accounts can silently change over time, so this turns a confusing
 * mid-test failure into an explicit one, run right after login.
 */
export async function assertState(
  detector: StateDetector,
  account: Account,
  declared: UserState,
): Promise<UserState> {
  const actual = await detector.detect(account);
  if (actual !== declared) {
    throw new AccountDriftError(
      `account ${account.phone} declared ${declared} but is actually ${actual} — registry drift`,
    );
  }
  return actual;
}
