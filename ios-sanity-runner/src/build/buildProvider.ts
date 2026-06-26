import type { Target } from '../types.ts';

export interface BuildArtifact {
  path: string;
  /** '.app' (simulator slice) or '.ipa' (device-signed). */
  kind: 'app' | 'ipa';
}

/**
 * Obtains the build under test. Implementations: local file, TestFlight, and
 * extract-from-device. The runner enforces the iOS slice rule downstream:
 * .app -> Simulator only, device-signed .ipa -> physical device only.
 */
export interface BuildProvider {
  readonly name: string;
  resolve(target: Target): Promise<BuildArtifact>;
}

export function kindForPath(path: string): BuildArtifact['kind'] {
  if (path.endsWith('.ipa')) return 'ipa';
  if (path.endsWith('.app')) return 'app';
  throw new Error(`unrecognized build artifact "${path}" (expected .app or .ipa)`);
}
