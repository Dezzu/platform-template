import { boolean, char, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from '../_helpers';

/**
 * Subscription plan catalogue. Drives the public pricing page and the quota checks.
 *
 * This table is the single source of truth: the plan list passed to the Better Auth
 * Stripe plugin is built from these rows at boot, so a price change is a seed/migration,
 * never a code change in two places.
 *
 * Global table — no organization_id (see CLAUDE.md, "the organization_id rule").
 */
export const plan = pgTable(
  'plan',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Stable machine name used in code and in `subscription.plan` (e.g. 'free', 'pro'). */
    key: text('key').notNull().unique(),

    /** i18n keys, never display strings — the pricing page is translated. */
    nameKey: text('name_key').notNull(),
    descriptionKey: text('description_key'),

    stripeProductId: text('stripe_product_id'),
    stripePriceIdMonthly: text('stripe_price_id_monthly'),
    stripePriceIdYearly: text('stripe_price_id_yearly'),

    /** Amounts in minor units (cents). Never use floating point for money. */
    amountMonthly: integer('amount_monthly').notNull().default(0),
    amountYearly: integer('amount_yearly').notNull().default(0),
    currency: char('currency', { length: 3 }).notNull().default('EUR'),

    /** Enforceable quotas, e.g. { "members": 5, "storageMb": 1024 }. */
    limits: jsonb('limits').notNull().default({}),
    /** Feature keys shown as bullet points on the pricing page. */
    features: jsonb('features').notNull().default([]),

    sortOrder: integer('sort_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    /** The plan a brand new organization starts on. Exactly one row should have this. */
    isDefault: boolean('is_default').notNull().default(false),

    ...timestamps,
  },
  (t) => [index('plan_active_sort_idx').on(t.isActive, t.sortOrder)],
);
