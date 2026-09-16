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

  // Platform state
  MAINTENANCE_MODE: 'MAINTENANCE_MODE',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
