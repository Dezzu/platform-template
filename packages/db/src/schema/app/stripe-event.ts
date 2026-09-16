import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Stripe webhook de-duplication log.
 *
 * The primary key IS the Stripe event id, and that is the whole idempotency mechanism:
 * the handler does `INSERT ... ON CONFLICT DO NOTHING RETURNING id`. No row returned
 * means we have already seen this event, so we answer 200 immediately and do nothing.
 *
 * Insert and enqueue must happen in the same transaction. The background job re-checks
 * idempotency on its own — a 200 from the webhook endpoint does not prove the job ran.
 *
 * Retain at least 7 days: Stripe retries a failing webhook for up to 72 hours.
 */
export const stripeEvent = pgTable(
  'stripe_event',
  {
    /** The Stripe event id, e.g. 'evt_1P...'. */
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    apiVersion: text('api_version'),
    payload: jsonb('payload').notNull(),

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
  },
  (t) => [
    index('stripe_event_type_idx').on(t.type),
    index('stripe_event_received_at_idx').on(t.receivedAt),
  ],
);
