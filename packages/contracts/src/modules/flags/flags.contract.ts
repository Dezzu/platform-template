import { z } from 'zod';
import { PageQuerySchema } from '../../common/pagination';

/**
 * Feature flags: what the product does, changed without a deploy.
 *
 * Resolution order, most specific first — the same order the backend implements and
 * the only one any caller should assume:
 *
 *   user override -> organization override -> percentage rollout -> global `enabled`
 *
 * The percentage is consulted only when the global switch is off and no override
 * matched: a flag that is on for everybody is on, and a rollout that could turn it
 * back off for a slice of users would make "enabled" mean something else.
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
  /** 0-100. Consulted only when `enabled` is false and no override matches. */
  rolloutPercent: z.number().int().min(0).max(100),
  /** How many per-user or per-organization exceptions exist for this flag. */
  overrideCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const FeatureFlagCreateSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(FLAG_KEY_PATTERN),
  description: z.string().trim().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
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
    rolloutPercent: z.number().int().min(0).max(100),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type FeatureFlagUpdate = z.infer<typeof FeatureFlagUpdateSchema>;

export const FeatureFlagListQuerySchema = PageQuerySchema;
export type FeatureFlagListQuery = z.infer<typeof FeatureFlagListQuerySchema>;

export const FeatureFlagOverrideSchema = z.object({
  id: z.uuid(),
  flagKey: z.string(),
  organizationId: z.string().nullable(),
  /** Denormalised for the admin screen: an id alone tells the reader nothing. */
  organizationName: z.string().nullable(),
  userId: z.string().nullable(),
  userEmail: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type FeatureFlagOverride = z.infer<typeof FeatureFlagOverrideSchema>;

/**
 * Exactly one subject, enforced here rather than only by the partial unique indexes:
 * an override with both set would be ambiguous, and one with neither would be a second
 * global switch competing with `enabled`.
 */
export const FeatureFlagOverrideCreateSchema = z
  .object({
    organizationId: z.string().trim().min(1).nullable().optional(),
    userId: z.string().trim().min(1).nullable().optional(),
    enabled: z.boolean(),
  })
  .refine((v) => Boolean(v.organizationId) !== Boolean(v.userId), {
    message: 'exactly one of organizationId or userId is required',
  });
export type FeatureFlagOverrideCreate = z.infer<typeof FeatureFlagOverrideCreateSchema>;

/**
 * The resolved answer for one caller: flag key to boolean, every known flag present.
 *
 * Resolved server-side for the same reason permissions are: the resolution rules have
 * one owner. A client that received the definitions and the overrides would be a
 * second implementation of the ordering above, drifting from the first.
 */
export const ResolvedFlagsSchema = z.record(z.string(), z.boolean());
export type ResolvedFlags = z.infer<typeof ResolvedFlagsSchema>;
