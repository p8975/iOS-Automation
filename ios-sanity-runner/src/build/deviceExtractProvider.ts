import { join } from 'node:path';
import type { Target } from '../types.ts';
import type { BuildProvider, BuildArtifact } from './buildProvider.ts';
import { run } from '../devices/exec.ts';
import { RunnerError } from '../types.ts';

/**
 * Pulls the already-installed app off a connected device via ideviceinstaller.
 * The extracted .ipa is DEVICE-SIGNED — it only re-installs on devices with
 * matching provisioning, and never on the Simulator. Mainly useful to re-test
 * exactly what's already on the device.
 */
export class DeviceExtractProvider implements BuildProvider {
  readonly name = 'device-extract';
  private readonly opts: { udid: string; bundleId: string; outDir: string };
  constructor(opts: { udid: string; bundleId: string; outDir: string }) {
    this.opts = opts;
  }

  async resolve(target: Target): Promise<BuildArtifact> {
    if (target === 'simulator') {
      throw new RunnerError('device-extract yields a device-signed .ipa; it cannot target the Simulator');
    }
    const out = join(this.opts.outDir, `${this.opts.bundleId}.ipa`);
    const res = await run(
      'ideviceinstaller',
      ['-u', this.opts.udid, '--archive', this.opts.bundleId, '-o', this.opts.outDir],
      180_000,
    );
    if (!res.ok) {
      throw new RunnerError(
        `device-extract failed (${res.stderr || res.stdout}). ` +
          `Note: extraction support varies by iOS version; prefer a CI-produced .ipa where possible.`,
      );
    }
    return { path: out, kind: 'ipa' };
  }
}
