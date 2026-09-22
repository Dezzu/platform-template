import { boolean, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { notificationChannel } from '../enums';
import { user } from '../auth.schema';
import { timestamps } from '../_helpers';

/**
 * Whether one person wants one kind of notification on one channel.
 *
 * User-scoped, and one of the declared exceptions to the `organization_id` rule: "do
 * not email me about invitations" is a statement about a person, not about a tenant.
 * Someone who belongs to four organizations sets it once.
 *
 * **A missing row is not "off".** It means "never decided", and the default comes from
 * the registry in the code — which is what lets a new notification type ship switched
 * on for everybody without backfilling a row per user per channel. Only an explicit
 * choice is stored, so the table stays small and the defaults stay changeable.
 */
export const notificationPreference = pgTable(
  'notification_preference',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** A key from the registry. Rows for types that no longer exist are simply ignored. */
    type: text('type').notNull(),
    channel: notificationChannel('channel').notNull(),

    enabled: boolean('enabled').notNull(),

    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.type, t.channel] })],
);
