import { run } from './exec.ts';
import type { DeviceManager, ResolvedDevice } from './deviceManager.ts';
import { RunnerError } from '../types.ts';

/**
 * Physical-device manager backed by libimobiledevice (idevice_id / ideviceinfo
 * / ideviceinstaller). Device discovery and .ipa install work with only the
 * Command Line Tools — no full Xcode needed for THIS layer. (Driving the UI
 * still needs Xcode for WebDriverAgent; see README.)
 *
 * Accepts only device-signed .ipa files — a Simulator .app cannot run here.
 */
export class PhysicalDeviceManager implements DeviceManager {
  readonly kind = 'device' as const;

  async list(): Promise<ResolvedDevice[]> {
    const ids = await run('idevice_id', ['-l']);
    if (!ids.ok) {
      throw new RunnerError(
        'idevice_id failed — install libimobiledevice (`brew install libimobiledevice`)',
      );
    }
    const udids = ids.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    const devices: ResolvedDevice[] = [];
    for (const udid of udids) {
      const info = await run('ideviceinfo', ['-u', udid, '-s']);
      const fields = parseInfo(info.stdout);
      devices.push({
        kind: 'device',
        udid,
        name: fields.DeviceName ?? 'iPhone',
        platformVersion: fields.ProductVersion ?? 'unknown',
        model: fields.ProductType,
      });
    }
    return devices;
  }

  async acquire(preferredUdid?: string): Promise<ResolvedDevice> {
    const all = await this.list();
    if (all.length === 0) throw new RunnerError('no physical iOS device connected/paired');
    const pick = preferredUdid ? all.find((d) => d.udid === preferredUdid) : all[0];
    if (!pick) throw new RunnerError(`device ${preferredUdid} not found among connected devices`);
    return pick;
  }

  async install(device: ResolvedDevice, buildPath: string): Promise<void> {
    if (!buildPath.endsWith('.ipa')) {
      throw new RunnerError(
        `physical device requires a device-signed .ipa, got "${buildPath}". ` +
          `A Simulator .app cannot be installed on a real device.`,
      );
    }
    const res = await run('ideviceinstaller', ['-u', device.udid, '-i', buildPath], 180_000);
    if (!res.ok) {
      throw new RunnerError(`ideviceinstaller failed: ${res.stderr || res.stdout}`);
    }
  }

  capabilities(device: ResolvedDevice): Record<string, unknown> {
    return {
      'appium:udid': device.udid,
      'appium:platformVersion': device.platformVersion,
      'appium:deviceName': device.name,
      // WDA must be signed for a real device — supplied via runner config.
    };
  }
}

function parseInfo(stdout: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf(':');
    if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}
