import { sql } from 'drizzle-orm';
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { user } from '../auth.schema';
import { deletionRequestStatus, deletionSubjectType } from '../enums';
import { timestamps } from '../_helpers';

/**
 * A pending erasure, and the thirty days somebody has to change their mind.
 *
 * Not organization-scoped, and that is the third documented exception to the tenancy
 * rule: the subject of an erasure is either an account or a whole tenant, so a column
 * saying which tenant it belongs to would be either wrong or a restatement of
 * `subject_id`.
 *
 * `subject_id` carries no foreign key for the same reason — it points at `user` or at
 * `organization` depending on `subject_type`, and a polymorphic reference cannot be
 * declared. The consequence is deliberate: when the subject is gone, this row stays.
 * It is the record that the erasure happened, and a cascade would delete the proof
 * along with the thing it is proof of.
 */
export const deletionRequest = pgTable(
  'deletion_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    subjectType: deletionSubjectType('subject_type').notNull(),
    /** A `user.id` or an `organization.id`. See above for why there is no FK. */
    subjectId: text('subject_id').notNull(),

    /** Null once that account is itself erased — the request outlives the requester. */
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    status: deletionRequestStatus('status').notNull().default('scheduled'),

    /** When it falls due. The grace period is server policy — see GDPR_DELETION_GRACE_DAYS. */
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),

    /** Free text, asked for once and shown only to an administrator. */
    reason: text('reason'),

    /** Why it could not be carried out, for the sweep's next attempt to be explicable. */
    error: text('error'),

    ...timestamps,
  },
  (t) => [
    /**
     * At most one open request per subject, enforced by the database rather than by a
     * check-then-insert: two clicks a second apart would otherwise schedule two
     * erasures, and the second would run against a tenant that no longer exists.
     * Partial, so a cancelled request does not block asking again.
     */
    uniqueIndex('deletion_request_open_uq')
      .on(t.subjectType, t.subjectId)
      .where(sql`status in ('scheduled', 'awaiting_billing')`),
    // What the sweep asks: anything open and due, across every tenant.
    index('deletion_request_due_idx').on(t.status, t.scheduledFor),
  ],
);
