import type { Target } from '../types.ts';

/** A concrete device or simulator the runner can install onto and drive. */
export interface ResolvedDevice {
  kind: 'simulator' | 'device';
  udid: string;
  name: string;
  /** iOS version, e.g. "18.7.8". */
  platformVersion: string;
  /** ProductType for devices (e.g. iPhone14,7) or runtime for sims. */
  model?: string;
}

/**
 * Abstraction over where a build runs. Two implementations today
 * (Simulator via simctl, physical device via libimobiledevice); a device-farm
 * provider slots in behind the same interface later.
 */
export interface DeviceManager {
  readonly kind: 'simulator' | 'device';
  /** Discover all usable targets of this kind. */
  list(): Promise<ResolvedDevice[]>;
  /** Boot/select a target; returns the one that will be driven. */
  acquire(preferredUdid?: string): Promise<ResolvedDevice>;
  /** Install a build artifact (path) onto the device. */
  install(device: ResolvedDevice, buildPath: string): Promise<void>;
  /** Appium capabilities fragment specific to this target. */
  capabilities(device: ResolvedDevice): Record<string, unknown>;
}

export function targetMatches(managerKind: 'simulator' | 'device', target: Target): boolean {
  return target === 'any' || target === managerKind;
}
