import { z } from 'zod';

/**
 * Reference contract — copy this shape for every new feature.
 *
 * Each feature file exports exactly: XxxSchema, XxxCreateSchema, XxxUpdateSchema,
 * XxxListQuerySchema (whichever apply) plus the inferred types. The API imports the
 * SCHEMAS for `@Body({ schema })`; Angular imports only the TYPES (`import type`), so
 * Zod never reaches the browser bundle unless a form actually validates client-side.
 */

export const PLAN_INTERVALS = ['monthly', 'yearly'] as const;
export type PlanInterval = (typeof PLAN_INTERVALS)[number];

/** Quota limits. -1 means unlimited; 0 means the feature is unavailable on this plan. */
export const PlanLimitsSchema = z.record(z.string(), z.number().int().min(-1));

export const PlanSchema = z.object({
  id: z.uuid(),
  /** Stable machine name used in code and in subscription.plan. */
  key: z.string().min(1),
  /** i18n keys — the pricing page translates them. Never display strings. */
  nameKey: z.string().min(1),
  descriptionKey: z.string().nullable(),
  /** Minor units (cents). */
  amountMonthly: z.int().nonnegative(),
  amountYearly: z.int().nonnegative(),
  currency: z.string().length(3),
  limits: PlanLimitsSchema,
  features: z.array(z.string()),
  sortOrder: z.int(),
  isDefault: z.boolean(),
});
export type Plan = z.infer<typeof PlanSchema>;

export const PlanListQuerySchema = z.object({
  /** Include plans flagged inactive. Off by default so the pricing page stays clean. */
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export type PlanListQuery = z.infer<typeof PlanListQuerySchema>;
