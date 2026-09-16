import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Small key/value store for runtime settings that must be changeable without a redeploy.
 *
 * Notably holds `maintenance_mode`:
 *   { "enabled": true, "messageKey": "maintenance.upgrading", "allowRoles": ["superadmin"],
 *     "until": "2026-01-01T00:00:00Z" }
 *
 * Read through a short-TTL cache — this is on the hot path of every request via
 * MaintenanceGuard, so it must not become a database round-trip per request.
 */
export const appSetting = pgTable('app_setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
