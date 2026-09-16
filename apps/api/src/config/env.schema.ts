import { z } from 'zod';

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
  DEFAULT_LOCALE: z.enum(['it', 'en']).default('it'),
  SUPPORTED_LOCALES: csv.pipe(z.array(z.string()).min(1)).or(z.array(z.string())),

  // ── Database ──────────────────────────────────────────────────────────────
  DATABASE_URL: z.string().min(1).startsWith('postgres'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),
  DATABASE_SSL: bool(false),

  // ── Redis / Valkey ────────────────────────────────────────────────────────
  REDIS_URL: z.string().min(1).startsWith('redis').default('redis://localhost:6379'),

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
  AWS_REGION: z.string().default('eu-west-1'),
  AWS_ACCESS_KEY_ID: z.string().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().default(''),

  // ── Storage ───────────────────────────────────────────────────────────────
  S3_ENDPOINT: z.url().default('http://localhost:9000'),
  // Not a preference: presigned signatures are region-bound and the shared
  // production MinIO is pinned to eu-west-1.
  S3_REGION: z.literal('eu-west-1').default('eu-west-1'),
  S3_BUCKET: z.string().min(1).default('app-dev'),
  S3_ACCESS_KEY_ID: z.string().default('minioadmin'),
  S3_SECRET_ACCESS_KEY: z.string().default('minioadmin'),
  S3_FORCE_PATH_STYLE: bool(true),
  S3_PRESIGN_EXPIRES: z.coerce.number().int().positive().default(900),

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
