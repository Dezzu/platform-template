import { z } from 'zod';
import { PageQuerySchema } from '../../common/pagination';

/**
 * Feature flags: an interruptor for a whole feature, changed without a deploy.
 *
 * **One global switch, and nothing else.** No per-user overrides, no per-organization
 * exceptions, no percentage rollout — those were here and were removed. What they
 * bought was gradual release to a slice of customers; what they cost was a resolution
 * order with four levels, a hash-bucketing scheme, two screens and a table, for a
 * product whose actual need is "this is still beta, keep it off".
 *
 * A flag is therefore a platform decision, taken by a superadmin, and it means the same
 * thing for everybody. If a pilot customer ever needs a feature the others do not, the
 * honest answer is a plan entitlement or a setting on the organization — both of which
 * are data about that customer, not a switch about the product.
 */

/**
 * `a.b.c`, lowercase. Keys end up in menus, guards and audit entries, so they are
 * constrained here rather than left to whoever types them into the admin screen —
 * a key with a space in it is a key nobody can grep for.
 */
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export const FeatureFlagSchema = z.object({
  key: z.string().regex(FLAG_KEY_PATTERN),
  description: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const FeatureFlagCreateSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(FLAG_KEY_PATTERN),
  description: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
});
export type FeatureFlagCreate = z.infer<typeof FeatureFlagCreateSchema>;

/**
 * The key is absent on purpose: renaming a flag would silently turn it off everywhere
 * the old name is still referenced. Delete and recreate instead — that at least makes
 * the breakage visible in the audit trail.
 */
export const FeatureFlagUpdateSchema = z
  .object({
    description: z.string().trim().max(500).nullable(),
    enabled: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type FeatureFlagUpdate = z.infer<typeof FeatureFlagUpdateSchema>;

export const FeatureFlagListQuerySchema = PageQuerySchema;
export type FeatureFlagListQuery = z.infer<typeof FeatureFlagListQuerySchema>;

/**
 * Every known flag and whether it is on, shipped with the session.
 *
 * Still resolved server-side even though the answer is now the same for everyone: the
 * client asks "is this on", not "what are the rules", and keeping that boundary is what
 * lets the rules change again without touching a single screen.
 */
export const ResolvedFlagsSchema = z.record(z.string(), z.boolean());
export type ResolvedFlags = z.infer<typeof ResolvedFlagsSchema>;
