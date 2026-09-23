import { boolean, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from '../_helpers';

/**
 * Feature flags: one row, one switch, the same answer for everybody.
 *
 * It used to carry a `rollout_percent` and have a companion `feature_flag_override`
 * table for per-user and per-organization exceptions. Both are gone: a four-level
 * resolution order and a hash-bucketing scheme are the machinery of gradual release to
 * a slice of customers, and this product's need is "this is still beta, keep it off".
 *
 * A flag that has to be true for one customer and false for another is not a flag —
 * it is an entitlement of their plan, or a setting on their organization. Those are
 * data about a customer; this is a decision about the product.
 */
export const featureFlag = pgTable('feature_flag', {
  key: text('key').primaryKey(),
  description: text('description'),
  enabled: boolean('enabled').notNull().default(false),
  ...timestamps,
});
