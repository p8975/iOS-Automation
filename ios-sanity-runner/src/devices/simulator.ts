import { run } from './exec.ts';
import type { DeviceManager, ResolvedDevice } from './deviceManager.ts';
import { RunnerError } from '../types.ts';

/**
 * Simulator manager backed by `xcrun simctl`. REQUIRES full Xcode (simctl ships
 * with Xcode, not the Command Line Tools). Accepts only a Simulator-slice .app
 * — a device-signed .ipa cannot run on the Simulator.
 */
export class SimulatorManager implements DeviceManager {
  readonly kind = 'simulator' as const;

  async list(): Promise<ResolvedDevice[]> {
    const res = await run('xcrun', ['simctl', 'list', 'devices', 'available', '--json']);
    if (!res.ok) {
      throw new RunnerError(
        'xcrun simctl unavailable — full Xcode is required for the Simulator (Command Line Tools are not enough)',
      );
    }
    const parsed = JSON.parse(res.stdout) as {
      devices: Record<string, Array<{ udid: string; name: string; state: string }>>;
    };
    const out: ResolvedDevice[] = [];
    for (const [runtime, devices] of Object.entries(parsed.devices)) {
      const version = runtime.replace(/.*iOS-/, '').replace(/-/g, '.');
      for (const d of devices) {
        out.push({ kind: 'simulator', udid: d.udid, name: d.name, platformVersion: version });
      }
    }
    return out;
  }

  async acquire(preferredUdid?: string): Promise<ResolvedDevice> {
    const all = await this.list();
    if (all.length === 0) throw new RunnerError('no available simulators');
    const pick = preferredUdid ? all.find((d) => d.udid === preferredUdid) : all[0];
    if (!pick) throw new RunnerError(`simulator ${preferredUdid} not found`);
    await run('xcrun', ['simctl', 'boot', pick.udid]); // no-op if already booted
    return pick;
  }

  async install(device: ResolvedDevice, buildPath: string): Promise<void> {
    if (!buildPath.endsWith('.app')) {
      throw new RunnerError(
        `Simulator requires a .app built for the simulator slice, got "${buildPath}". ` +
          `A device-signed .ipa (TestFlight/App Store) cannot run on the Simulator.`,
      );
    }
    const res = await run('xcrun', ['simctl', 'install', device.udid, buildPath]);
    if (!res.ok) throw new RunnerError(`simctl install failed: ${res.stderr || res.stdout}`);
  }

  capabilities(device: ResolvedDevice): Record<string, unknown> {
    return {
      'appium:udid': device.udid,
      'appium:platformVersion': device.platformVersion,
      'appium:deviceName': device.name,
    };
  }
}
