import { index, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { organization, user } from '../auth.schema';
import { projectStatus } from '../enums';
import { timestamps } from '../_helpers';

/**
 * The template's worked example of a domain feature. Copy this file's shape when
 * adding a real one.
 *
 * The important part is the first column: `organization_id NOT NULL` with a cascade.
 * Every domain table has it, it is indexed, and it is always the first predicate of
 * every query. TenantRepository enforces that so it cannot be forgotten — see
 * apps/api/src/database/tenant.repository.ts.
 */
export const project = pgTable(
  'project',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    name: text('name').notNull(),
    description: text('description'),
    status: projectStatus('status').notNull().default('active'),

    createdByUserId: text('created_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),

    ...timestamps,
  },
  (t) => [
    // Composite with the usual sort column: every list query filters by organization
    // and orders by recency, so this index serves both halves.
    index('project_org_created_idx').on(t.organizationId, t.createdAt.desc()),
    // Names are unique per tenant, never globally.
    uniqueIndex('project_org_name_uq').on(t.organizationId, t.name),
  ],
);
