import { z } from 'zod';

/**
 * Platform metrics: how much the product is used, and what it earns.
 *
 * Deliberately separate from Grafana, and not a duplication of it. Grafana answers "is
 * the system healthy?" — it is an operations tool, it lives on the VPS and it needs
 * access not everybody has. This answers "is the product working?", lives behind the
 * application's own auth and is part of its surface. Two questions, two audiences; they
 * do not belong on one screen.
 */

/** One point of a daily series. The date is `YYYY-MM-DD`, not a timestamp. */
export const MetricPointSchema = z.object({
  date: z.string(),
  value: z.number().nonnegative(),
});
export type MetricPoint = z.infer<typeof MetricPointSchema>;

export const UsageMetricsSchema = z.object({
  users: z.int().nonnegative(),
  organizations: z.int().nonnegative(),
  /** Organizations with at least one member active in the last 30 days. */
  activeOrganizations: z.int().nonnegative(),

  /**
   * Distinct users whose session was touched inside the window.
   *
   * An approximation, and worth knowing before it goes in a slide: Better Auth only
   * rewrites the session row once it is older than `SESSION_UPDATE_AGE`, so the real
   * granularity is that, not the minute. It does count people who only read, which a
   * DAU built on the audit log would miss.
   */
  dau: z.int().nonnegative(),
  wau: z.int().nonnegative(),
  mau: z.int().nonnegative(),

  signupsLast30Days: z.int().nonnegative(),
  /** Against the previous 30 days, in percent. Null when there was nothing to compare. */
  signupsTrendPercent: z.number().nullable(),
});
export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;

export const RevenueMetricsSchema = z.object({
  /**
   * Amounts in **minor units**, like everywhere else in the product. Never floating
   * point for money, and formatting into a currency is the renderer's problem.
   */
  mrrCents: z.int().nonnegative(),
  arrCents: z.int().nonnegative(),
  /** Average revenue per paying account. Zero when there are none. */
  arpaCents: z.int().nonnegative(),
  currency: z.string().length(3),

  activeSubscriptions: z.int().nonnegative(),
  trialingSubscriptions: z.int().nonnegative(),
  /** Live but already cancelled: next month's churn, visible now. */
  cancellingSubscriptions: z.int().nonnegative(),
  churnedLast30Days: z.int().nonnegative(),
});
export type RevenueMetrics = z.infer<typeof RevenueMetricsSchema>;

/** What each plan carries. Ordered by revenue, not by name. */
export const PlanBreakdownSchema = z.object({
  key: z.string(),
  subscriptions: z.int().nonnegative(),
  mrrCents: z.int().nonnegative(),
});
export type PlanBreakdown = z.infer<typeof PlanBreakdownSchema>;

export const PlatformMetricsSchema = z.object({
  /**
   * When the figures were computed, not when they were asked for.
   *
   * They are cached for a few minutes and the screen says so: a dashboard that looks
   * live and is not gets decisions made on stale numbers without anybody noticing.
   */
  generatedAt: z.iso.datetime(),
  usage: UsageMetricsSchema,
  revenue: RevenueMetricsSchema,
  signupsPerDay: MetricPointSchema.array(),
  activeUsersPerDay: MetricPointSchema.array(),
  plans: PlanBreakdownSchema.array(),
});
export type PlatformMetrics = z.infer<typeof PlatformMetricsSchema>;
