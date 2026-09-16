import { baseEnvSchema, crossFieldIssues, envSchema, type Env } from './env.schema';

let validated: Env | undefined;

/**
 * Best-effort per-field parse, used only to produce a complete error report when the
 * strict parse has already failed. Fields that do not parse are simply omitted.
 */
function partiallyParsed(raw: Record<string, unknown>): Partial<Env> {
  const out: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(baseEnvSchema.shape)) {
    const parsed = fieldSchema.safeParse(raw[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as Partial<Env>;
}

/**
 * Passed to ConfigModule.forRoot({ validate }).
 *
 * Reports EVERY problem at once and then exits. Failing on the first bad variable
 * turns configuring a new deployment into a guessing game, so this prints the whole
 * list — and it exits rather than throwing, because a half-configured process that
 * keeps running is worse than one that refuses to start.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const messages = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `  ✗ ${path}: ${issue.message}`;
    });

    // Zod skips `.superRefine()` when the object parse fails, so the cross-field rules
    // would otherwise stay hidden until the field errors were fixed. Re-run them
    // against whatever did parse so one run reports everything.
    for (const issue of crossFieldIssues(partiallyParsed(raw))) {
      const line = `  ✗ ${issue.path}: ${issue.message}`;
      if (!messages.includes(line)) messages.push(line);
    }

    const issues = messages.sort();

    // console.error, not the Nest logger: the DI container does not exist yet.
    console.error(
      [
        '',
        `Invalid environment configuration — ${issues.length} problem(s) found:`,
        '',
        ...issues,
        '',
        'Compare your .env against .env.example, which mirrors apps/api/src/config/env.schema.ts.',
        '',
      ].join('\n'),
    );
    process.exit(1);
  }

  validated = result.data;
  return result.data;
}

/** The validated environment. Throws if read before ConfigModule has validated it. */
export function env(): Env {
  if (!validated) {
    throw new Error('Environment accessed before validation — is ConfigModule imported?');
  }
  return validated;
}

/**
 * Configuration with every secret-looking value masked, for /health/info and for log
 * lines. Never log the raw config object.
 */
export function redactedConfig(): Record<string, unknown> {
  const SECRET = /secret|key|password|token|dsn|url/i;
  return Object.fromEntries(
    Object.entries(env()).map(([key, value]) => {
      if (!SECRET.test(key)) return [key, value];
      if (typeof value !== 'string' || value.length === 0) return [key, value];
      return [key, `${value.slice(0, 4)}…redacted`];
    }),
  );
}
