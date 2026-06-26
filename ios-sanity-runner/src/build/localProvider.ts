import { existsSync } from 'node:fs';
import type { Target } from '../types.ts';
import type { BuildProvider, BuildArtifact } from './buildProvider.ts';
import { kindForPath } from './buildProvider.ts';
import { RunnerError } from '../types.ts';

/**
 * A build already on disk. Supply BOTH a sim .app and a device .ipa to support
 * either target; the provider returns the artifact whose slice matches.
 */
export class LocalBuildProvider implements BuildProvider {
  readonly name = 'local';
  private readonly opts: { appPath?: string; ipaPath?: string };
  constructor(opts: { appPath?: string; ipaPath?: string }) {
    this.opts = opts;
  }

  async resolve(target: Target): Promise<BuildArtifact> {
    const wantIpa = target === 'device';
    const wantApp = target === 'simulator';
    if (wantApp || (target === 'any' && this.opts.appPath)) {
      return this.use(this.opts.appPath, 'app', '.app for the Simulator');
    }
    if (wantIpa || (target === 'any' && this.opts.ipaPath)) {
      return this.use(this.opts.ipaPath, 'ipa', '.ipa for a physical device');
    }
    throw new RunnerError(`no local build configured for target "${target}"`);
  }

  private use(path: string | undefined, kind: BuildArtifact['kind'], desc: string): BuildArtifact {
    if (!path) throw new RunnerError(`local provider: no ${desc} configured`);
    if (!existsSync(path)) throw new RunnerError(`local build not found: ${path}`);
    if (kindForPath(path) !== kind) throw new RunnerError(`expected ${desc}, got ${path}`);
    return { path, kind };
  }
}
