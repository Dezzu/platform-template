import { timestamp } from 'drizzle-orm/pg-core';

/**
 * Every table gets these. `withTimezone` is not optional: storing naive timestamps
 * in a product that sells across timezones is a bug waiting for the first DST change.
 */
export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/**
 * Only for tables that genuinely need recovery or legal retention (see CLAUDE.md).
 * Default is a hard delete — do not add this to a table "just in case".
 */
export const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};
