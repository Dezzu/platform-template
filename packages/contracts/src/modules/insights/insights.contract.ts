import { z } from 'zod';

/**
 * A small paid feature, used to demonstrate the paywall end to end.
 *
 * Replace it with something real; keep the shape of how it is gated.
 */
export const InsightsSchema = z.object({
  totalProjects: z.int().nonnegative(),
  activeProjects: z.int().nonnegative(),
  archivedProjects: z.int().nonnegative(),
  createdLast30Days: z.int().nonnegative(),
  /** The plan that entitles the caller to see this. */
  plan: z.string(),
});
export type Insights = z.infer<typeof InsightsSchema>;
