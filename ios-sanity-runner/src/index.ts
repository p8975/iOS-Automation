/**
 * Public module surface. Import this package into another tool as a module:
 *
 *   import { RunController, AccountRegistry, loadRunnerConfig, loadSuiteDir }
 *     from 'ios-sanity-runner';
 *
 * Everything below is a stable, side-effect-free export. The CLI (src/cli.ts)
 * is just one consumer of this API.
 */
export { RunController, type RunOptions } from './engine/runController.ts';
export { mapWithConcurrency } from './engine/concurrency.ts';
export { AccountRegistry } from './registry/accountRegistry.ts';
export {
  type LeaseStore,
  InMemoryLeaseStore,
  FileLockLeaseStore,
} from './registry/leaseStore.ts';
export { expandMatrix, type ExpectationMatrix, type MatrixRow } from './suite/matrix.ts';
export { loadRunnerConfig, type RunnerConfig, type LoginLocators } from './config/config.ts';
export { autoLogin, type AutoLoginConfig, type AutoLoginResult } from './login/appLogin.ts';
export { loadSuiteFile, loadSuiteDir } from './suite/loader.ts';
export { suiteSchema, type SuiteDefinition, type LocatorSpec } from './suite/schema.ts';
export { Reporter } from './reporter/reporter.ts';

// Live run events + the optional dashboard (additive; the engine works without them).
export {
  EventHub,
  newRunId,
  runStartedEvent,
  runFinishedEvent,
  type RunEvent,
  type RunObserver,
  type SuiteRef,
} from './events/runEvents.ts';
export {
  RunStore,
  type StoredRun,
  type StoredSuite,
  type RunStatus,
  type SuiteStatus,
} from './dashboard/runStore.ts';
export {
  startDashboard,
  type DashboardHandle,
  type DashboardOptions,
  type DashboardCapabilities,
  type TriggerRequest,
  type TriggerResult,
} from './dashboard/server.ts';
export { ingestRun, emitRunEvent, LiveRun, type PushResult } from './dashboard/liveClient.ts';

// Autonomous exploratory crawl (read-only safe by default).
export { Explorer, type ExploreParams } from './explore/explorer.ts';
export {
  crawl,
  type UiProbe,
  type UiElement,
  type ScreenHealth,
  type CrawlOptions,
  type CrawlOutcome,
} from './explore/crawler.ts';
export { AppiumProbe, parseInteractive, type ParsedControl } from './explore/appiumProbe.ts';
export { DEFAULT_DENY, isDestructive } from './explore/denylist.ts';

export { createOtpProvider } from './otp/index.ts';
export type { OtpProvider, OtpConfig, OtpStrategy } from './otp/otpProvider.ts';

export { LocalBuildProvider } from './build/localProvider.ts';
export { DeviceExtractProvider } from './build/deviceExtractProvider.ts';
export { TestFlightProvider } from './build/testflightProvider.ts';
export type { BuildProvider, BuildArtifact } from './build/buildProvider.ts';

export { SimulatorManager } from './devices/simulator.ts';
export { PhysicalDeviceManager } from './devices/physicalDevice.ts';
export { DevicePool } from './devices/devicePool.ts';
export type { DeviceManager, ResolvedDevice } from './devices/deviceManager.ts';

export { BackendStateDetector, assertState, type StateDetector } from './state/stateDetector.ts';
export { resolveLocator, describeLocator } from './locators/locatorEngine.ts';

export * from './types.ts';
