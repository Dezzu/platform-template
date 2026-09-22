import { DEFAULT_APP_MODE, isAppMode, type AppMode } from '@app/contracts';

/**
 * The configured product mode, readable from code that runs outside Nest's DI.
 *
 * `auth.config.ts` and the Stripe plugin are module singletons — the Better Auth CLI
 * imports the first one directly to generate the schema, with no container in sight —
 * so they cannot inject `appConfig`. This is the one seam that reads `process.env`
 * for them, in a single place, with the default in a single place too.
 *
 * Everything inside the container should take the mode from `appConfig.mode` instead.
 */
export function appMode(): AppMode {
  const raw = process.env['APP_MODE'] ?? '';
  return isAppMode(raw) ? raw : DEFAULT_APP_MODE;
}
