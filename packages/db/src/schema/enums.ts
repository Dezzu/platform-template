import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Postgres enums, named `<table>_<column>`. Kept in one file so the set is easy to
 * review — adding a value is a migration, removing one is a breaking change.
 */
export const projectStatus = pgEnum('project_status', ['active', 'archived']);

/**
 * Upload is a two-step protocol and the status is what makes it safe: a row is
 * `pending` from the moment the presigned PUT is handed out until the commit call
 * verifies the object exists. Nothing but the janitor ever looks at a `pending` row,
 * so a client that walks away mid-upload leaves no visible file.
 */
export const fileStatus = pgEnum('file_status', ['pending', 'ready']);

/** Lifecycle of an outgoing email, from queued to delivered to the provider. */
export const emailMessageStatus = pgEnum('email_message_status', ['pending', 'sent', 'failed']);

/**
 * Where a notification can reach somebody.
 *
 * Two channels and no more for now: the in-app centre, and email. A third — push,
 * Slack — is a value here plus a sender; the preference table and the resolution logic
 * already treat the channel as data rather than as two hardcoded branches.
 */
export const notificationChannel = pgEnum('notification_channel', ['in_app', 'email']);

/** Whose data an export covers: one person, or one tenant and everyone in it. */
export const gdprExportScope = pgEnum('gdpr_export_scope', ['user', 'organization']);

/**
 * `expired` is a state, not the absence of a file. Somebody following a link from a
 * week-old email should be told the archive expired rather than shown a 404 that reads
 * like the export never ran.
 */
export const gdprExportStatus = pgEnum('gdpr_export_status', [
  'pending',
  'processing',
  'ready',
  'failed',
  'expired',
]);

export const deletionSubjectType = pgEnum('deletion_subject_type', ['user', 'organization']);

/**
 * Erasure is a state machine because of one state: `awaiting_billing`. An organization
 * that still has a live subscription when its erasure falls due is neither erased nor
 * forgotten — it waits and is looked at again. See docs/gdpr.md.
 */
export const deletionRequestStatus = pgEnum('deletion_request_status', [
  'scheduled',
  'awaiting_billing',
  'cancelled',
  'executed',
  'failed',
]);
