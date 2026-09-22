import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';
import { timestamps } from '../_helpers';

/**
 * One thing that happened, addressed to one person inside one organization.
 *
 * Org-scoped like every domain table: a notification is about something that happened
 * in a tenant, and the same account belonging to two organizations must see two
 * separate trails. The preference that decides whether it is ever written is NOT
 * org-scoped — see `notification_preference`.
 *
 * Nothing here is pre-rendered. `titleKey` and `bodyKey` are i18n keys and `params`
 * are their placeholders, because the reader can change language at any time and a
 * notification written in Italian last month would stay Italian forever. The keys are
 * stored rather than derived from `type` on purpose: wording moves, and an old
 * notification keeps the key it was written with instead of silently re-rendering as
 * whatever that type says today.
 */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    /** The recipient. Not the actor — who caused it lives in `params` if it matters. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** A key from the registry in packages/contracts. Drives preferences and icon. */
    type: text('type').notNull(),

    titleKey: text('title_key').notNull(),
    bodyKey: text('body_key').notNull(),
    /** Placeholders for the two keys above. Never a rendered sentence. */
    params: jsonb('params').$type<Record<string, unknown>>(),

    /** Where clicking it goes, as an in-app route. Null when there is nowhere to go. */
    actionUrl: text('action_url'),

    readAt: timestamp('read_at', { withTimezone: true }),

    ...timestamps,
  },
  (t) => [
    // The only query the centre makes: this person, this tenant, newest first.
    index('notification_recipient_idx').on(t.organizationId, t.userId, t.createdAt.desc()),
  ],
);
