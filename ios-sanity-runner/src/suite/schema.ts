import { z } from 'zod';
import { USER_STATES } from '../types.ts';

/**
 * Zod schema for the human-authored YAML test DSL. Authors write steps; the
 * engine validates against this before running so a typo fails fast and loud
 * rather than mid-flow on a real device.
 */

const userStateEnum = z.enum(USER_STATES);

/** A locator: exactly one resolution strategy, in priority order. */
export const locatorSchema = z
  .object({
    accessibility_id: z.string().optional(),
    predicate: z.string().optional(),
    class_chain: z.string().optional(),
    xpath: z.string().optional(),
    text: z.string().optional(),
    coordinates: z.object({ x: z.number(), y: z.number() }).optional(),
  })
  .refine((o) => Object.values(o).filter((v) => v !== undefined).length === 1, {
    message: 'a locator must specify exactly one strategy',
  });

export type LocatorSpec = z.infer<typeof locatorSchema>;

// --- action steps ---------------------------------------------------------

const tap = z.object({ tap: locatorSchema });
const type_ = z.object({
  type: locatorSchema.and(z.object({ text: z.string() })),
});
const swipe = z.object({
  swipe: z.object({
    from: locatorSchema.optional(),
    to: locatorSchema.optional(),
    direction: z.enum(['up', 'down', 'left', 'right']).optional(),
  }),
});
const scroll = z.object({
  scroll: z.object({ to: locatorSchema, direction: z.enum(['up', 'down']).default('down') }),
});
const waitFor = z.object({
  wait_for: locatorSchema.and(z.object({ timeout: z.number().positive().default(15) })),
});
const assertVisible = z.object({ assert_visible: locatorSchema });
const assertNotVisible = z.object({ assert_not_visible: locatorSchema });
const assertText = z.object({
  assert_text: locatorSchema.and(
    z.object({ equals: z.string().optional(), contains: z.string().optional() }),
  ),
});
const fail = z.object({ fail: z.string() });
const useFlow = z.object({ use_flow: z.string() });
const assertMatrix = z.object({ assert_matrix: z.object({ matrix: z.string() }) });

// `branch` is recursive (its cases hold steps), so declare lazily.
export const stepSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    tap,
    type_,
    swipe,
    scroll,
    waitFor,
    assertVisible,
    assertNotVisible,
    assertText,
    fail,
    useFlow,
    assertMatrix,
    branch,
  ]),
);

/** A named expectations matrix: state -> { visible / absent accessibility ids }. */
const matrixRow = z.object({ visible: z.array(z.string()).optional(), absent: z.array(z.string()).optional() });
const matricesSchema = z.record(z.string(), z.record(z.string(), matrixRow));

const branch = z.object({
  branch: z.object({
    on: z.literal('detected_user_state'),
    cases: z.record(z.string(), z.array(stepSchema)),
  }),
});

// --- setup verbs ----------------------------------------------------------

const loginStep = z.object({ login: z.object({ otp: z.literal('auto').default('auto') }) });
const assertStateStep = z.object({ assert_state: userStateEnum });
const setupStepSchema = z.union([loginStep, assertStateStep, ...[]]);

// --- suite ----------------------------------------------------------------

export const suiteSchema = z.object({
  suite: z.string().min(1),
  description: z.string().optional(),
  target: z.enum(['any', 'simulator', 'device']).default('any'),
  requires: userStateEnum,
  flows: z.record(z.string(), z.array(stepSchema)).optional(),
  matrices: matricesSchema.optional(),
  setup: z.array(z.union([loginStep, assertStateStep])).default([]),
  steps: z.array(stepSchema),
  // teardown uses the same real, handled verbs as `steps` — log out by tapping
  // the logout control or via `use_flow`, so typos fail validation instead of
  // matching a permissive placeholder.
  teardown: z.array(stepSchema).default([]),
});

export type SuiteDefinition = z.infer<typeof suiteSchema>;
export type SetupStep = z.infer<typeof setupStepSchema>;
