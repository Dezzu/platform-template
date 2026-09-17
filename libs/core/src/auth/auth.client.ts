import { DOCUMENT, inject, InjectionToken } from '@angular/core';
import { createAuthClient } from 'better-auth/client';
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { stripeClient } from '@better-auth/stripe/client';
import { CORE_CONFIG } from '../config/core.config';

/**
 * Resolves a possibly relative base URL to an absolute one.
 *
 * The Better Auth client refuses a relative path — it constructs a `URL` internally and
 * throws "Invalid base URL" — while the rest of the application deliberately uses
 * relative paths so the same bundle runs on localhost, on a preview host and in
 * production without being rebuilt.
 *
 * Resolving against `document.baseURI` rather than `window.location` keeps this working
 * during server-side rendering, where there is no `window`, and honours a `<base href>`
 * if the application is ever served from a sub-path.
 */
export function resolveAuthBaseUrl(configured: string, baseURI: string): string {
  if (/^https?:\/\//i.test(configured)) return configured;
  return new URL(configured, baseURI).toString().replace(/\/$/, '');
}

export type AuthClient = ReturnType<typeof createClient>;

function createClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    // Must mirror the server's plugin list, or the typed endpoints will not exist.
    plugins: [
      organizationClient(),
      adminClient(),
      twoFactorClient(),
      // `subscription: true` is what adds the typed subscription endpoints.
      stripeClient({ subscription: true }),
    ],
    fetchOptions: {
      // The session lives in an httpOnly cookie: it has to ride along on every call,
      // and no token is ever readable from JavaScript.
      credentials: 'include',
    },
  });
}

export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return createClient(resolveAuthBaseUrl(inject(CORE_CONFIG).authUrl, document.baseURI));
  },
});
