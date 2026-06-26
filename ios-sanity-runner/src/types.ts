/**
 * Core domain types shared across every module.
 *
 * NOTE: we deliberately avoid TS `enum` so the codebase runs under Node's
 * native type-stripping (and `erasableSyntaxOnly`) with zero transpile step.
 * User states are a plain string union backed by a `const` object.
 */

/** Canonical user states. Add a new state here + a registry block + a matrix row. */
export const USER_STATES = [
  'TRIAL_ELIGIBLE_USER',
  'IN_TRIAL_USER',
  'SUBSCRIBED_USER',
  'TRIAL_CHURNED_USER',
  'SUBSCRIPTION_CHURNED_USER',
  'PAUSED_USER',
] as const;

export type UserState = (typeof USER_STATES)[number];

export function isUserState(value: string): value is UserState {
  return (USER_STATES as readonly string[]).includes(value);
}

/** Which physical target a build/run is bound to. */
export type Target = 'simulator' | 'device' | 'any';

/** A single pre-provisioned test account from the registry. */
export interface Account {
  /** State this account is provisioned into. */
  state: UserState;
  /** Phone in E.164, e.g. +9190000000001. Treated as a secret. */
  phone: string;
  loginType: 'otp';
  /** Optional per-account bypass code override. */
  bypassCode?: string;
  notes?: string;
}

/** A leased account plus the handle needed to return it to the pool. */
export interface AccountLease {
  account: Account;
  release: () => void;
}

/** Result of running one step. */
export interface StepResult {
  ok: boolean;
  action: string;
  detail?: string;
  error?: string;
  screenshotPath?: string;
  durationMs: number;
}

/** Result of running one suite against one target. */
export interface SuiteResult {
  suite: string;
  target: Target;
  state: UserState;
  ok: boolean;
  steps: StepResult[];
  startedAt: string;
  finishedAt: string;
  error?: string;
}

export class RunnerError extends Error {
  override readonly name: string = 'RunnerError';
}

export class AccountDriftError extends RunnerError {
  override readonly name = 'AccountDriftError';
}

export class NoAvailableAccountError extends RunnerError {
  override readonly name = 'NoAvailableAccountError';
}

export class LocatorNotFoundError extends RunnerError {
  override readonly name = 'LocatorNotFoundError';
}
