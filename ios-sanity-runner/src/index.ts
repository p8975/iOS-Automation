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
export { AccountRegistry } from './registry/accountRegistry.ts';
export { loadRunnerConfig, type RunnerConfig, type LoginLocators } from './config/config.ts';
export { loadSuiteFile, loadSuiteDir } from './suite/loader.ts';
export { suiteSchema, type SuiteDefinition, type LocatorSpec } from './suite/schema.ts';
export { Reporter } from './reporter/reporter.ts';

export { createOtpProvider } from './otp/index.ts';
export type { OtpProvider, OtpConfig, OtpStrategy } from './otp/otpProvider.ts';

export { LocalBuildProvider } from './build/localProvider.ts';
export { DeviceExtractProvider } from './build/deviceExtractProvider.ts';
export { TestFlightProvider } from './build/testflightProvider.ts';
export type { BuildProvider, BuildArtifact } from './build/buildProvider.ts';

export { SimulatorManager } from './devices/simulator.ts';
export { PhysicalDeviceManager } from './devices/physicalDevice.ts';
export type { DeviceManager, ResolvedDevice } from './devices/deviceManager.ts';

export { BackendStateDetector, assertState, type StateDetector } from './state/stateDetector.ts';
export { resolveLocator, describeLocator } from './locators/locatorEngine.ts';

export * from './types.ts';
