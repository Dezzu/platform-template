import { bigint, index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';
import { fileStatus } from '../enums';
import { softDelete, timestamps } from '../_helpers';

/**
 * An object in the bucket, and the row that makes it findable.
 *
 * Uploads happen in two steps, and this table is what holds them together:
 *
 *   1. the client asks for a ticket → row inserted as `pending`, presigned PUT returned
 *   2. the client PUTs the bytes straight to MinIO, never through the API
 *   3. the client calls commit → the API HEADs the object and flips the row to `ready`
 *
 * The bytes never pass through Node, which is the point: a 200 MB upload would
 * otherwise occupy an API process for its whole duration. The cost is that step 2 can
 * fail silently, which is why `pending` rows exist at all and why a janitor job sweeps
 * the ones older than a day (see files.janitor).
 *
 * Soft-deleted rather than hard-deleted: a file referenced by an invoice or an audit
 * entry must still be explicable after someone removes it.
 */
export const file = pgTable(
  'file',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    /**
     * The key inside the bucket: `{orgId}/{yyyy}/{mm}/{uuid}-{slug}`. Unique because
     * the row and the object have to stay one-to-one — two rows pointing at one object
     * means deleting either takes the file away from the other.
     */
    objectKey: text('object_key').notNull(),

    /** What the user called it. Never used to build the key — it is attacker input. */
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),

    /**
     * Declared at ticket time, replaced at commit time with what MinIO actually
     * reports. A client that declares 1 KB and uploads 1 GB is caught by the commit,
     * not trusted.
     */
    size: bigint('size', { mode: 'number' }).notNull().default(0),
    /** The object's ETag, recorded at commit so a later overwrite is detectable. */
    etag: text('etag'),

    status: fileStatus('status').notNull().default('pending'),

    uploadedByUserId: text('uploaded_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('file_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    uniqueIndex('file_object_key_uq').on(t.objectKey),
    // The janitor sweeps by status and age across every tenant, so this one is
    // deliberately not led by organization_id.
    index('file_status_created_idx').on(t.status, t.createdAt),
  ],
);
