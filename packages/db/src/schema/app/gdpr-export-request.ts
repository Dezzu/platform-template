import { bigint, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';
import { gdprExportScope, gdprExportStatus } from '../enums';
import { timestamps } from '../_helpers';

/**
 * One request for a copy of somebody's data, and the archive it produced.
 *
 * `organization_id` is **nullable**, which makes this one of the documented exceptions
 * to the tenancy rule in CLAUDE.md: a person asking for their own data is asking about
 * themselves, not about a tenant, and the same account can belong to several. It is
 * set only for `scope = 'organization'`, where it is the tenant being exported.
 *
 * The row outlives the archive on purpose. After the retention window the object is
 * deleted and the row moves to `expired`, so the history of who asked for what — which
 * is itself something a data protection officer gets asked about — survives the file.
 */
export const gdprExportRequest = pgTable(
  'gdpr_export_request',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Who asked. Always present: an export is always requested by a person. */
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    /** The tenant being exported. Null for a personal export — see above. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

    scope: gdprExportScope('scope').notNull(),
    status: gdprExportStatus('status').notNull().default('pending'),

    /** Where the archive landed in the bucket. Null until the worker has written it. */
    objectKey: text('object_key'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),

    /** After this, the object is swept and the row becomes `expired`. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),

    /** Why it failed, for the screen to show something better than "failed". */
    error: text('error'),

    ...timestamps,
  },
  (t) => [
    // The only query the screen makes: mine, newest first.
    index('gdpr_export_user_idx').on(t.userId, t.createdAt.desc()),
    // The sweep runs across every tenant, so this one is deliberately not led by
    // organization_id.
    index('gdpr_export_sweep_idx').on(t.status, t.expiresAt),
  ],
);
