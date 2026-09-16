import { z } from 'zod';

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/**
 * Shared query shape for every list endpoint. Query strings are always text, so the
 * numeric fields coerce — validation happens once here rather than in each controller.
 */
export const PageQuerySchema = z.object({
  page: z.coerce.number().int().nonnegative().default(0),
  // Capped deliberately: an unbounded `size` is a trivial denial-of-service vector.
  size: z.coerce.number().int().positive().max(200).default(25),
  sort: z.string().min(1).optional(),
  dir: z.enum(SORT_DIRECTIONS).default('asc'),
  /** Free-text search term. */
  q: z.string().trim().min(1).optional(),
});
export type PageQuery = z.infer<typeof PageQuerySchema>;
