import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import {
  type Account,
  type AccountLease,
  type UserState,
  NoAvailableAccountError,
  isUserState,
} from '../types.ts';
import { type LeaseStore, InMemoryLeaseStore } from './leaseStore.ts';

/**
 * Central registry: the single source of truth for all test credentials,
 * organized by user state. Supports multiple accounts per state (a pool) so
 * parallel runs don't collide and accounts can be rotated.
 *
 * Adding/removing/swapping an account = editing accounts.yaml only.
 *
 * Leasing is delegated to a `LeaseStore`. The default in-memory store is right
 * for one runner; pass a `FileLockLeaseStore` to make leasing safe across
 * multiple runner PROCESSES (a device farm) without changing any call site.
 */
export class AccountRegistry {
  private readonly pools = new Map<UserState, Account[]>();
  private readonly leases: LeaseStore;

  constructor(leases: LeaseStore = new InMemoryLeaseStore()) {
    this.leases = leases;
  }

  static fromFile(path: string, leases?: LeaseStore): AccountRegistry {
    const raw = yaml.load(readFileSync(path, 'utf8'));
    return AccountRegistry.fromObject(raw, leases);
  }

  static fromObject(raw: unknown, leases?: LeaseStore): AccountRegistry {
    const registry = new AccountRegistry(leases);
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
   */
  checkout(state: UserState): AccountLease {
    const pool = this.pools.get(state);
    if (!pool || pool.length === 0) {
      throw new NoAvailableAccountError(`no accounts provisioned for state ${state}`);
    }
    const free = pool.find((a) => this.leases.tryAcquire(a.phone));
    if (!free) {
      throw new NoAvailableAccountError(
        `all ${pool.length} accounts for ${state} are currently leased; add more to the pool`,
      );
    }
    let released = false;
    return {
      account: free,
      release: () => {
        if (released) return;
        released = true;
        this.leases.release(free.phone);
      },
    };
  }
}
