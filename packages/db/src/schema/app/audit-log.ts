import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';

/**
 * Append-only record of who did what. Never updated, never deleted by application code.
 *
 * Two deliberate design points:
 *
 * - `actorEmail` duplicates data that lives on `user`. That is on purpose: GDPR
 *   deletion anonymises the user row, and an audit trail that becomes unreadable
 *   afterwards is useless precisely when you need it. The FK is ON DELETE SET NULL so
 *   the entry survives, and the snapshot keeps it legible.
 * - `traceId` links the entry to the distributed trace, so "who changed this" and
 *   "what did the system do about it" are one click apart.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Null for platform-level actions that do not belong to any tenant. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Snapshot so the entry stays readable after the user is deleted or anonymised. */
    actorEmail: text('actor_email'),
    /** Set when a platform admin performed this while impersonating the actor. */
    impersonatorUserId: text('impersonator_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    /** `verb.noun`, e.g. 'project.created', 'member.removed'. */
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),

    before: jsonb('before'),
    after: jsonb('after'),

    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    traceId: text('trace_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    index('audit_log_action_idx').on(t.action),
    index('audit_log_resource_idx').on(t.resourceType, t.resourceId),
  ],
);
