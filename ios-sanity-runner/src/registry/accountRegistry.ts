import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import {
  type Account,
  type AccountLease,
  type UserState,
  NoAvailableAccountError,
  isUserState,
} from '../types.ts';

/**
 * Central registry: the single source of truth for all test credentials,
 * organized by user state. Supports multiple accounts per state (a pool) so
 * parallel runs don't collide and accounts can be rotated.
 *
 * Adding/removing/swapping an account = editing accounts.yaml only.
 */
export class AccountRegistry {
  private readonly pools = new Map<UserState, Account[]>();
  private readonly leased = new Set<string>(); // phone numbers currently in use

  static fromFile(path: string): AccountRegistry {
    const raw = yaml.load(readFileSync(path, 'utf8'));
    return AccountRegistry.fromObject(raw);
  }

  static fromObject(raw: unknown): AccountRegistry {
    const registry = new AccountRegistry();
    const accounts = (raw as { accounts?: Record<string, unknown> })?.accounts;
    if (!accounts || typeof accounts !== 'object') {
      throw new Error('registry: missing top-level `accounts` map');
    }
    for (const [stateName, entries] of Object.entries(accounts)) {
      if (!isUserState(stateName)) {
        throw new Error(`registry: unknown user state "${stateName}"`);
      }
      if (!Array.isArray(entries)) {
        throw new Error(`registry: state "${stateName}" must hold a list of accounts`);
      }
      const pool: Account[] = entries.map((e, i) => {
        const entry = e as Record<string, unknown>;
        if (typeof entry.phone !== 'string' || entry.phone.length === 0) {
          throw new Error(`registry: ${stateName}[${i}] missing "phone"`);
        }
        return {
          state: stateName,
          phone: entry.phone,
          loginType: 'otp',
          bypassCode: typeof entry.bypass_code === 'string' ? entry.bypass_code : undefined,
          notes: typeof entry.notes === 'string' ? entry.notes : undefined,
        };
      });
      registry.pools.set(stateName, pool);
    }
    return registry;
  }

  /** Phone counts per state — used by `doctor` and coverage reporting. */
  summary(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [state, pool] of this.pools) out[state] = pool.length;
    return out;
  }

  /**
   * Lease a free account for the given state. The runner resolves accounts by
   * STATE NAME at runtime; credentials never live in a test case.
   *
   * In-process leasing is sufficient for one runner driving N devices. For
   * cross-process parallelism (a device farm) swap this Set for a lockfile or
   * Redis lease — the call site does not change.
   */
  checkout(state: UserState): AccountLease {
    const pool = this.pools.get(state);
    if (!pool || pool.length === 0) {
      throw new NoAvailableAccountError(`no accounts provisioned for state ${state}`);
    }
    const free = pool.find((a) => !this.leased.has(a.phone));
    if (!free) {
      throw new NoAvailableAccountError(
        `all ${pool.length} accounts for ${state} are currently leased; add more to the pool`,
      );
    }
    this.leased.add(free.phone);
    let released = false;
    return {
      account: free,
      release: () => {
        if (released) return;
        released = true;
        this.leased.delete(free.phone);
      },
    };
  }
}
