import type { DeviceManager, ResolvedDevice } from './deviceManager.ts';
import { RunnerError } from '../types.ts';

/**
 * Leases physical targets for parallel runs. Built on the same DeviceManager
 * abstraction, so a remote farm provider drops in unchanged. One device is
 * leased per concurrent suite; `withDevice` guarantees return even on failure.
 */
export class DevicePool {
  private readonly manager: DeviceManager;
  private readonly inUse = new Set<string>();
  private available: ResolvedDevice[] | null = null;

  constructor(manager: DeviceManager) {
    this.manager = manager;
  }

  /** Number of targets this pool can run in parallel. */
  async capacity(): Promise<number> {
    return (await this.ensure()).length;
  }

  private async ensure(): Promise<ResolvedDevice[]> {
    if (this.available === null) this.available = await this.manager.list();
    return this.available;
  }

  /** Run `fn` with an exclusively-leased device, returning it afterwards. */
  async withDevice<R>(fn: (device: ResolvedDevice) => Promise<R>): Promise<R> {
    const all = await this.ensure();
    const device = all.find((d) => !this.inUse.has(d.udid));
    if (!device) throw new RunnerError('device pool exhausted — no free target');
    this.inUse.add(device.udid);
    try {
      return await fn(device);
    } finally {
      this.inUse.delete(device.udid);
    }
  }
}
