import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';
import { emailMessageStatus } from '../enums';
import { timestamps } from '../_helpers';

/**
 * One row per outgoing email, so "did the invitation ever arrive?" is a question the
 * support person can answer from the admin UI instead of from the SES console.
 *
 * **Deliberate exception to the organization_id rule** (see CLAUDE.md): the column is
 * nullable here. Verification and password-reset emails are sent to people who have no
 * organization yet — at signup the tenant does not exist — and a NOT NULL column would
 * force either a fake tenant or a second table for the same thing.
 *
 * `params` is stored REDACTED. The rendered body is not stored at all. A reset email
 * contains a link that is, for its lifetime, equivalent to the password: keeping it in
 * a table that outlives the token turns a database read into account takeover. The
 * full parameters travel in the BullMQ job instead, which is deleted the moment the
 * send succeeds.
 */
export const emailMessage = pgTable(
  'email_message',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Null for emails that precede any tenant — signup verification, password reset. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

    /** Null when the recipient is not (yet) a user: an invitation to a new address. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    toEmail: text('to_email').notNull(),

    /** Key into the template registry, e.g. 'organization-invitation'. */
    template: text('template').notNull(),
    locale: text('locale').notNull(),
    /** Rendered subject, kept because it is what a human recognises in a list. */
    subject: text('subject').notNull(),
    /** Render parameters with every secret-looking value masked. */
    params: jsonb('params'),

    status: emailMessageStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** The provider's id, which is what a bounce report will refer to later. */
    providerMessageId: text('provider_message_id'),
    lastError: text('last_error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    index('email_message_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('email_message_to_created_idx').on(t.toEmail, t.createdAt.desc()),
    index('email_message_status_idx').on(t.status),
  ],
);
