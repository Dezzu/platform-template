import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';
import { timestamps } from '../_helpers';

/**
 * One thing that happened, addressed to one person inside one organization.
 *
 * Org-scoped like every domain table — **except when it is not about a tenant at all**.
 * `organization_id` is nullable, and that is the fourth documented exception to the
 * tenancy rule: "la copia dei tuoi dati è pronta" is a fact about a person, and forcing
 * it into a tenant would mean the same message showing under one organization and not
 * another, or not showing at all for somebody who belongs to none. A null there means
 * "addressed to you, wherever you are working".
 *
 * What is NOT relaxed is the recipient. Every read path filters on `user_id` as well,
 * and that — not the tenant column — is what keeps one member out of another's mail.
 * The preference that decides whether a notification is ever written is user-scoped too
 * — see `notification_preference`.
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

    /** Null when the notification is about the person rather than about a tenant. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

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
    // The tenant trail: this person, this tenant, newest first.
    index('notification_recipient_idx').on(t.organizationId, t.userId, t.createdAt.desc()),
    /**
     * Led by the recipient, because the centre now asks for "mine in this tenant, plus
     * mine that belong to no tenant" — and an index led by `organization_id` cannot
     * serve the second half of that.
     */
    index('notification_user_idx').on(t.userId, t.createdAt.desc()),
  ],
);
