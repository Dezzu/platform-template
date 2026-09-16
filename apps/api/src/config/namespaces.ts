import { registerAs } from '@nestjs/config';
import { env } from './validate-env';

/**
 * Namespaced, typed configuration. Inject it as:
 *
 *   constructor(@Inject(dbConfig.KEY) private readonly db: ConfigType<typeof dbConfig>) {}
 *
 * Services must never read `process.env` directly — that bypasses validation and
 * defaults, and makes the dependency invisible.
 */
export const appConfig = registerAs('app', () => {
  const e = env();
  return {
    name: e.APP_NAME,
    env: e.NODE_ENV,
    isProduction: e.NODE_ENV === 'production',
    port: e.APP_PORT,
    url: e.APP_URL,
    webUrl: e.WEB_URL,
    dashboardUrl: e.DASHBOARD_URL,
    logLevel: e.LOG_LEVEL,
    defaultLocale: e.DEFAULT_LOCALE,
    supportedLocales: e.SUPPORTED_LOCALES,
  };
});

export const dbConfig = registerAs('db', () => {
  const e = env();
  return { url: e.DATABASE_URL, poolMax: e.DATABASE_POOL_MAX, ssl: e.DATABASE_SSL };
});

export const redisConfig = registerAs('redis', () => ({ url: env().REDIS_URL }));

export const authConfig = registerAs('auth', () => {
  const e = env();
  return {
    secret: e.BETTER_AUTH_SECRET,
    url: e.BETTER_AUTH_URL,
    trustedOrigins: e.AUTH_TRUSTED_ORIGINS,
    sessionExpiresIn: e.SESSION_EXPIRES_IN,
    sessionUpdateAge: e.SESSION_UPDATE_AGE,
    cookieDomain: e.COOKIE_DOMAIN,
    google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET },
  };
});

export const stripeConfig = registerAs('stripe', () => {
  const e = env();
  return {
    secretKey: e.STRIPE_SECRET_KEY,
    webhookSecret: e.STRIPE_WEBHOOK_SECRET,
    publishableKey: e.STRIPE_PUBLISHABLE_KEY,
    automaticTax: e.STRIPE_AUTOMATIC_TAX,
    taxIdCollection: e.STRIPE_TAX_ID_COLLECTION,
  };
});

export const mailConfig = registerAs('mail', () => {
  const e = env();
  return {
    driver: e.MAIL_DRIVER,
    from: e.MAIL_FROM,
    smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT },
    aws: {
      region: e.AWS_REGION,
      accessKeyId: e.AWS_ACCESS_KEY_ID,
      secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
    },
  };
});

export const storageConfig = registerAs('storage', () => {
  const e = env();
  return {
    endpoint: e.S3_ENDPOINT,
    region: e.S3_REGION,
    bucket: e.S3_BUCKET,
    accessKeyId: e.S3_ACCESS_KEY_ID,
    secretAccessKey: e.S3_SECRET_ACCESS_KEY,
    forcePathStyle: e.S3_FORCE_PATH_STYLE,
    presignExpiresSeconds: e.S3_PRESIGN_EXPIRES,
  };
});

export const otelConfig = registerAs('otel', () => {
  const e = env();
  return {
    enabled: e.OTEL_ENABLED,
    serviceName: e.OTEL_SERVICE_NAME,
    endpoint: e.OTEL_EXPORTER_OTLP_ENDPOINT,
  };
});

export const gdprConfig = registerAs('gdpr', () => {
  const e = env();
  return { deletionGraceDays: e.GDPR_DELETION_GRACE_DAYS, exportTtlHours: e.GDPR_EXPORT_TTL_HOURS };
});

export const configNamespaces = [
  appConfig,
  dbConfig,
  redisConfig,
  authConfig,
  stripeConfig,
  mailConfig,
  storageConfig,
  otelConfig,
  gdprConfig,
];
