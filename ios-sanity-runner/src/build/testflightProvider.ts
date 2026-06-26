import type { Target } from '../types.ts';
import type { BuildProvider, BuildArtifact } from './buildProvider.ts';
import { RunnerError } from '../types.ts';

/**
 * TestFlight builds are App-Store-signed .ipa files installed through the
 * TestFlight app — the raw signed .ipa is not cleanly sideloadable for
 * automation, and it can NEVER run on the Simulator.
 *
 * Recommended pipeline instead: have CI emit TWO artifacts per build — a
 * Simulator .app and a dev/ad-hoc-signed .ipa — and feed them via LocalBuild
 * Provider. This stub fails with that guidance rather than pretending to work,
 * and is the seam where App Store Connect API download lands in Phase 4.
 */
export class TestFlightProvider implements BuildProvider {
  readonly name = 'testflight';
  private readonly _opts: { appId?: string; version?: string };
  constructor(opts: { appId?: string; version?: string } = {}) {
    this._opts = opts;
  }

  async resolve(_target: Target): Promise<BuildArtifact> {
    throw new RunnerError(
      'TestFlight acquisition is not wired in the MVP. Use a CI-produced dev/ad-hoc .ipa ' +
        '(device) or Simulator .app via LocalBuildProvider. See README "Build sources".',
    );
  }
}
