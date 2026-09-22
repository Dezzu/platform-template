/**
 * Stable, machine-readable error codes.
 *
 * This is the reason every response is wrapped in an envelope: the frontend renders
 * `errors.${messageCode}` through i18n, so the HTTP layer never has to carry a
 * human-readable sentence and error text can be translated and reworded without
 * touching the backend.
 *
 * Rules:
 *  - codes are append-only; renaming one breaks every translated client
 *  - `<DOMAIN>_<CONDITION>`, screaming snake case
 *  - every code needs a matching key in libs/i18n (`errors.<CODE>`) in BOTH locales
 */
export const ERROR_CODES = {
  // Generic
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',

  // Authentication / authorization
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  FORBIDDEN_MISSING_PERMISSION: 'FORBIDDEN_MISSING_PERMISSION',

  // Organizations
  ORGANIZATION_NOT_FOUND: 'ORGANIZATION_NOT_FOUND',
  ORGANIZATION_REQUIRED: 'ORGANIZATION_REQUIRED',

  // Billing
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',

  // Membership and invitations
  /** Removing or demoting this member would leave the organization without an owner. */
  ORGANIZATION_LAST_OWNER: 'ORGANIZATION_LAST_OWNER',
  MEMBER_ALREADY_EXISTS: 'MEMBER_ALREADY_EXISTS',
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_ALREADY_SENT: 'INVITATION_ALREADY_SENT',
  INVITATION_EXPIRED: 'INVITATION_EXPIRED',
  /** Changing your own role or removing yourself has to go through a different door. */
  CANNOT_MODIFY_SELF: 'CANNOT_MODIFY_SELF',
  /** Granting a role you do not hold yourself. */
  CANNOT_GRANT_HIGHER_ROLE: 'CANNOT_GRANT_HIGHER_ROLE',

  // Files and storage
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TYPE_NOT_ALLOWED: 'FILE_TYPE_NOT_ALLOWED',
  /** Commit was called but no object exists at the key — the PUT never happened. */
  FILE_NOT_UPLOADED: 'FILE_NOT_UPLOADED',
  /** The object exists but does not match what the ticket declared. */
  FILE_UPLOAD_MISMATCH: 'FILE_UPLOAD_MISMATCH',
  /** The file is still `pending`: there is nothing to download yet. */
  FILE_NOT_READY: 'FILE_NOT_READY',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',

  // Platform state
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  FLAG_NOT_FOUND: 'FLAG_NOT_FOUND',
  /** A flag with that key already exists — keys are the identity, so they are unique. */
  FLAG_ALREADY_EXISTS: 'FLAG_ALREADY_EXISTS',
  /** There is already an override for that flag and that subject. */
  FLAG_OVERRIDE_EXISTS: 'FLAG_OVERRIDE_EXISTS',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
