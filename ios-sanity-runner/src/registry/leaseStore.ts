import { mkdirSync, openSync, closeSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Backs account leasing. The in-memory store is correct for ONE runner driving
 * N devices; the file-lock store extends the SAME contract to multiple runner
 * PROCESSES (a device farm), so two CI shards never lease the same login.
 *
 * The registry depends only on this interface — swapping stores does not change
 * any call site (the seam promised in the design).
 */
export interface LeaseStore {
  /** Atomically claim a key. Returns false if already held. */
  tryAcquire(key: string): boolean;
  /** Release a previously claimed key. No-op if not held. */
  release(key: string): void;
}

export class InMemoryLeaseStore implements LeaseStore {
  private readonly held = new Set<string>();
  tryAcquire(key: string): boolean {
    if (this.held.has(key)) return false;
    this.held.add(key);
    return true;
  }
  release(key: string): void {
    this.held.delete(key);
  }
}

/**
 * Cross-process leasing via exclusive lockfiles. `openSync(..., 'wx')` fails if
 * the file exists, giving an atomic test-and-set even across processes on the
 * same filesystem. Locks older than `staleMs` are reclaimed so a crashed runner
 * can't strand an account forever.
 */
export class FileLockLeaseStore implements LeaseStore {
  private readonly dir: string;
  private readonly staleMs: number;

  constructor(dir: string, staleMs = 15 * 60_000) {
    this.dir = dir;
    this.staleMs = staleMs;
    mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    // Lockfile name must be filesystem-safe (phone numbers contain '+').
    return join(this.dir, `${encodeURIComponent(key)}.lock`);
  }

  tryAcquire(key: string): boolean {
    const path = this.path(key);
    this.reclaimIfStale(path);
    try {
      closeSync(openSync(path, 'wx'));
      return true;
    } catch {
      return false;
    }
  }

  release(key: string): void {
    rmSync(this.path(key), { force: true });
  }

  private reclaimIfStale(path: string): void {
    try {
      if (Date.now() - statSync(path).mtimeMs > this.staleMs) rmSync(path, { force: true });
    } catch {
      /* not present — nothing to reclaim */
    }
  }

  /** Test/ops helper: keys currently leased in this lock dir. */
  activeLeases(): string[] {
    try {
      return readdirSync(this.dir)
        .filter((f) => f.endsWith('.lock'))
        .map((f) => decodeURIComponent(f.replace(/\.lock$/, '')));
    } catch {
      return [];
    }
  }
}
