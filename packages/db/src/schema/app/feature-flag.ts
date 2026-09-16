import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../_helpers';

/**
 * Global feature flag definitions. Per-organization and per-user overrides live in
 * `feature_flag_override` (added once the auth tables exist).
 *
 * Resolution order: user override -> organization override -> percentage rollout
 * (stable hash of flagKey + organizationId) -> this global `enabled`.
 */
export const featureFlag = pgTable('feature_flag', {
  key: text('key').primaryKey(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(false),
  /** 0-100. Only consulted when `enabled` is false and no override matches. */
  rolloutPercent: integer('rollout_percent').notNull().default(0),
  ...timestamps,
});
