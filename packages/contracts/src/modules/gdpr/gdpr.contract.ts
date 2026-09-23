import { z } from 'zod';

/**
 * The two rights that need machinery: access (article 15) and erasure (article 17).
 *
 * Both are asynchronous by nature — an export reads half the database and an erasure
 * has a thirty-day mind-changing window — so neither is a request/response. What the
 * screen shows is the *state* of a request, which is why these schemas describe rows
 * rather than results.
 */

/** Whose data. A person can ask for their own; an organization is asked for by role. */
export const GDPR_EXPORT_SCOPES = ['user', 'organization'] as const;
export type GdprExportScope = (typeof GDPR_EXPORT_SCOPES)[number];

/**
 * `expired` is a state of its own rather than an absent file: somebody who comes back
 * to a link from a week-old email deserves "this expired, ask again", not a 404 that
 * reads like the export never happened.
 */
export const GDPR_EXPORT_STATUSES = [
  'pending',
  'processing',
  'ready',
  'failed',
  'expired',
] as const;
export type GdprExportStatus = (typeof GDPR_EXPORT_STATUSES)[number];

export const GdprExportRequestSchema = z.object({
  id: z.uuid(),
  scope: z.enum(GDPR_EXPORT_SCOPES),
  status: z.enum(GDPR_EXPORT_STATUSES),
  /** Null until the archive exists. */
  sizeBytes: z.number().int().nonnegative().nullable(),
  /** When the archive stops being downloadable. Null until it exists. */
  expiresAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /**
   * Whether a download can be asked for right now.
   *
   * Sent rather than derived in the browser from `status` and `expiresAt`: expiry is a
   * comparison against the *server's* clock, and a client whose clock is a day off
   * would offer a button that answers 410.
   */
  downloadable: z.boolean(),
});
export type GdprExportRequest = z.infer<typeof GdprExportRequestSchema>;

/** A presigned GET. Short-lived, and never stored anywhere that outlives the click. */
export const GdprExportDownloadSchema = z.object({
  url: z.string(),
  expiresAt: z.iso.datetime(),
});
export type GdprExportDownload = z.infer<typeof GdprExportDownloadSchema>;

export const DELETION_SUBJECT_TYPES = ['user', 'organization'] as const;
export type DeletionSubjectType = (typeof DELETION_SUBJECT_TYPES)[number];

/**
 * A state machine, not a flag.
 *
 * `awaiting_billing` is the state that makes it one: an organization that still has a
 * live subscription when its erasure comes due is not erased and not forgotten either
 * — it waits, and the sweep looks again. Deleting a paying tenant because a job was
 * due is the failure this state exists to prevent.
 */
export const DELETION_REQUEST_STATUSES = [
  'scheduled',
  'awaiting_billing',
  'cancelled',
  'executed',
  'failed',
] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

export const DeletionRequestSchema = z.object({
  id: z.uuid(),
  subjectType: z.enum(DELETION_SUBJECT_TYPES),
  subjectId: z.string(),
  status: z.enum(DELETION_REQUEST_STATUSES),
  /** When it will be carried out. The grace period is server policy, not a client's. */
  scheduledFor: z.iso.datetime(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type DeletionRequest = z.infer<typeof DeletionRequestSchema>;

/**
 * No subject in the body: which one is being erased comes from the route, because the
 * two need different permissions and a guard cannot read a body. `/deletion-requests/
 * account` is self-service; `/deletion-requests/organization` is behind `org.delete`.
 */
export const DeletionRequestCreateSchema = z.object({
  /**
   * Optional and free text, kept because "why did you leave" is the one question this
   * form can answer honestly. Never shown back to anybody but an administrator.
   */
  reason: z.string().max(500).optional(),
});
export type DeletionRequestCreate = z.infer<typeof DeletionRequestCreateSchema>;
