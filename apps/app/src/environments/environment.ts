/**
 * Development configuration.
 *
 * Swapped for environment.prod.ts at build time through `fileReplacements`, never read
 * at runtime: a value baked into the bundle cannot be wrong in one deployment and
 * right in another.
 *
 * `/api` is relative on purpose — in development the dev-server proxies it (see
 * proxy.conf.json) and in production nginx does, so the browser never needs to know
 * where the API lives.
 */
export const environment = {
  production: false,
  appName: 'SaaS Template',
  apiUrl: '/api',
  authUrl: '/api/auth',
};
