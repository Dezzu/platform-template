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
  /**
   * Origin of the marketing site, which owns the legal pages.
   *
   * Absolute rather than relative because it is a *different application*: the cookie
   * banner and the sign-up form link to `/privacy-policy` and `/terms`, and a relative
   * path would resolve against the dashboard's own host and 404.
   */
  webUrl: 'http://localhost:4200',
};
