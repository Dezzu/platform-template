import { z } from 'zod';
import { APP_MODES, ORG_ROLES } from '@app/contracts';

const bool = (def: boolean) =>
  z
    .enum(['true', 'false'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true');

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const;
/**
 * How the lines are shaped: JSON for a collector, `pretty` for a person.
 *
 * Production must be `json` — `pretty` routes every line through a worker thread and
 * produces something Loki cannot parse into fields, so the trace correlation that is
 * the whole point of structured logging is lost.
 */
export const LOG_FORMATS = ['json', 'pretty'] as const;
export const MAIL_DRIVERS = ['smtp', 'ses'] as const;

/**
 * The single source of truth for configuration. `.env.example` mirrors this file and
 * the two must stay in step — a variable that exists in one and not the other is a bug.
 *
 * Optional entries belong to features that arrive in a later phase; they are validated
 * when present and required only where `superRefine` says production needs them.
 */
const baseEnvSchema = z.object({
  // ── App ───────────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  APP_NAME: z.string().min(1).default('saas-template'),
  APP_PORT: z.coerce.number().int().positive().max(65535).default(3000),
  APP_URL: z.url().default('http://localhost:3000'),
  WEB_URL: z.url().default('http://localhost:4200'),
  DASHBOARD_URL: z.url().default('http://localhost:4300'),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_FORMAT: z.enum(LOG_FORMATS).default('json'),
  /**
   * What kind of product this deployment is — see the contract in
   * packages/contracts/src/common/app-mode.ts and
   * docs/modalita-utente-e-organizzazione.md.
   *
   * One variable rather than three switches: whether the person or the tenant pays,
   * whether an organization is created silently at signup, and whether the members
   * screen exists are one decision, and a deployment that answered them differently
   * would be a product that cannot explain itself.
   */
  APP_MODE: z.enum(APP_MODES).default('b2c'),
  DEFAULT_LOCALE: z.enum(['it', 'en']).default('it'),
  SUPPORTED_LOCALES: csv.pipe(z.array(z.string()).min(1)).or(z.array(z.string())),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1).startsWith('postgres'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_SSL: bool(false),

  // ── Redis / Valkey ────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1).startsWith('redis').default('redis://localhost:6379'),

  // ── Queue (BullMQ) ────────────────────────────────────────────────────────
  /**
   * Key prefix for every BullMQ structure. It matters because the production Valkey
   * is shared: two applications defaulting to the same prefix would consume each
   * other's jobs. Empty falls back to APP_NAME, which is already unique per app.
   */
  QUEUE_PREFIX: z.string().default(''),
  /**
   * Whether this process also consumes jobs. False on the API containers once a
   * dedicated worker container exists (phase 11); true in development, where running
   * two processes to send one email is not worth it.
   */
  QUEUE_RUN_WORKERS: bool(true),
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(100).default(5),
  /** Retries per job before it lands in the failed set. */
  QUEUE_ATTEMPTS: z.coerce.number().int().positive().max(20).default(5),

  // ── Better Auth ───────────────────────────────────────────────────────────
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  AUTH_TRUSTED_ORIGINS: csv,
  SESSION_EXPIRES_IN: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24 * 7),
  SESSION_UPDATE_AGE: z.coerce
    .number()
    .int()
    .positive()
    .default(60 * 60 * 24),
  COOKIE_DOMAIN: z.string().default(''),
  /**
   * Platform-level role given to every new account (Better Auth admin plugin).
   * Deliberately the least privileged value: the permission catalogue grants 'user'
   * no platform rights at all, so promoting someone has to be an explicit act.
   */
  AUTH_DEFAULT_ROLE: z.string().min(1).default('user'),
  /**
   * Whether a new account must click the emailed link before it can sign in.
   *
   * Off by default so a fresh clone is usable the second it boots, and required in
   * production by `crossFieldIssues` — an unverified address is an address you cannot
   * bill, cannot reset, and did not prove the signer-up controls.
   */
  AUTH_REQUIRE_EMAIL_VERIFICATION: bool(false),
  /** Role of whoever creates an organization. */
  ORG_CREATOR_ROLE: z.enum(ORG_ROLES).default('owner'),
  /** Role assigned to anyone who joins an existing organization. */
  ORG_DEFAULT_ROLE: z.enum(ORG_ROLES).default('member'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),

  // ── Stripe (phase 7) ──────────────────────────────────────────────────────
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PUBLISHABLE_KEY: z.string().default(''),
  STRIPE_AUTOMATIC_TAX: bool(true),
  STRIPE_TAX_ID_COLLECTION: bool(true),

  // ── Mail (phase 8) ────────────────────────────────────────────────────────
  MAIL_DRIVER: z.enum(MAIL_DRIVERS).default('smtp'),
  MAIL_FROM: z.string().default('SaaS Template <no-reply@example.com>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  /** TLS on connect (port 465). STARTTLS on 587 is negotiated regardless. */
  SMTP_SECURE: bool(false),
  /** Empty for Mailpit, which accepts anything. */
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  AWS_REGION: z.string().default('eu-west-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),
  /**
   * SES configuration set. Bounces and complaints are only reportable through one, and
   * adding it after the first send means the early history is lost — so it is wired
   * now even though the SNS side arrives later.
   */
  MAIL_SES_CONFIGURATION_SET: z.string().default(''),

  // ── Storage ───────────────────────────────────────────────────────────────
  S3_ENDPOINT: z.url().default('http://localhost:9000'),
  // Not a preference: presigned signatures are region-bound and the shared
  // production MinIO is pinned to eu-west-1.
  S3_REGION: z.literal('eu-west-1').default('eu-west-1'),
  S3_BUCKET: z.string().min(1).default('app-dev'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  /**
   * The endpoint the BROWSER must reach. Presigned signatures cover the Host header,
   * so a URL signed for an internal address (`http://minio:9000`) fails with a
   * signature mismatch the moment a browser resolves it differently. Empty means the
   * two are the same, which is the case in development.
   */
  S3_PUBLIC_ENDPOINT: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool(true),
  S3_PRESIGN_EXPIRES: z.coerce.number().int().positive().default(900),
  /** Refused before a URL is issued, and re-checked against the real object on commit. */
  STORAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(25 * 1024 * 1024),
  /** Allowlist of content types. Empty means "anything", which is rarely what you want. */
  STORAGE_ALLOWED_MIME: csv,
  /** How long a `pending` row survives before the janitor removes it. */
  STORAGE_PENDING_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // ── Observability (phase 10) ──────────────────────────────────────────────
  OTEL_ENABLED: bool(false),
  OTEL_SERVICE_NAME: z.string().default('saas-template-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default('http://localhost:4318'),

  // ── GDPR (phase 9) ────────────────────────────────────────────────────────
  GDPR_DELETION_GRACE_DAYS: z.coerce.number().int().positive().default(30),
  GDPR_EXPORT_TTL_HOURS: z.coerce.number().int().positive().default(48),
});

/**
 * Cross-field rules, kept separate from the object schema on purpose.
 *
 * Zod skips `.superRefine()` when the underlying object parse fails, which would mean
 * a developer fixes three field errors, restarts, and only then discovers the
 * production rules. `validateEnv` therefore runs these against whatever fields did
 * parse, so a single run reports everything that is wrong.
 *
 * Every check must tolerate a missing field — the input is deliberately partial.
 */
export function crossFieldIssues(env: Partial<Env>): { path: string; message: string }[] {
  const issues: { path: string; message: string }[] = [];
  const add = (path: string, message: string): void => {
    issues.push({ path, message });
  };
  const isProd = env.NODE_ENV === 'production';

  // A short secret is the difference between "signed" and "forgeable".
  if (env.BETTER_AUTH_SECRET !== undefined && env.BETTER_AUTH_SECRET.length < 32) {
    add(
      'BETTER_AUTH_SECRET',
      'must be at least 32 characters — generate with `openssl rand -base64 32`',
    );
  }

  if (env.AUTH_TRUSTED_ORIGINS?.includes('*')) {
    add('AUTH_TRUSTED_ORIGINS', 'wildcard origins are never allowed; list the exact origins');
  }

  if (!isProd) return issues;

  if (env.AUTH_TRUSTED_ORIGINS?.length === 0) {
    add(
      'AUTH_TRUSTED_ORIGINS',
      'required in production, otherwise the browser clients cannot sign in',
    );
  }

  if (env.AUTH_REQUIRE_EMAIL_VERIFICATION === false) {
    add(
      'AUTH_REQUIRE_EMAIL_VERIFICATION',
      'must be true in production — an unverified address cannot be billed or reset',
    );
  }

  if (env.MAIL_FROM?.includes('example.com')) {
    add('MAIL_FROM', 'still the placeholder address; set a domain you actually control');
  }

  if (env.MAIL_DRIVER !== undefined && env.MAIL_DRIVER !== 'ses') {
    add('MAIL_DRIVER', 'must be "ses" in production — smtp points at the local Mailpit container');
  }

  for (const key of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const) {
    if (env[key] === '') add(key, 'required in production when MAIL_DRIVER is "ses"');
  }

  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const) {
    if (env[key] === '') add(key, 'required in production');
  }

  if (env.S3_ACCESS_KEY_ID === 'minioadmin' || env.S3_SECRET_ACCESS_KEY === 'minioadmin') {
    add(
      'S3_ACCESS_KEY_ID',
      'the local MinIO development credentials must not be used in production',
    );
  }

  return issues;
}

/** Full schema: field validation plus the cross-field rules. */
export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  for (const issue of crossFieldIssues(env)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
  }
});

export { baseEnvSchema };
export type Env = z.infer<typeof baseEnvSchema>;
