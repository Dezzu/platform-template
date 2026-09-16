import { sql } from 'drizzle-orm';
import { boolean, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { featureFlag } from './feature-flag';
import { organization, user } from '../auth.schema';
import { timestamps } from '../_helpers';

/**
 * Per-user or per-organization overrides of a global flag.
 *
 * Resolution order, most specific first:
 *   user override -> organization override -> percentage rollout -> global `enabled`.
 *
 * Exactly one of userId / organizationId is set; the partial unique indexes enforce
 * that there is at most one override per (flag, subject).
 */
export const featureFlagOverride = pgTable(
  'feature_flag_override',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    flagKey: text('flag_key')
      .notNull()
      .references(() => featureFlag.key, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('feature_flag_override_org_uq')
      .on(t.flagKey, t.organizationId)
      .where(sql`${t.organizationId} is not null`),
    uniqueIndex('feature_flag_override_user_uq')
      .on(t.flagKey, t.userId)
      .where(sql`${t.userId} is not null`),
  ],
);
