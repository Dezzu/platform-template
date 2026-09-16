import { inject, InjectionToken } from '@angular/core';
import { createAuthClient } from 'better-auth/client';
import { adminClient, organizationClient, twoFactorClient } from 'better-auth/client/plugins';
import { CORE_CONFIG } from '../config/core.config';

/**
 * The Better Auth browser client.
 *
 * Provided through a token rather than created at module scope so its base URL comes
 * from provideCore() — the same library then serves both applications, and tests can
 * point it somewhere else.
 *
 * The plugin list must mirror the server's, or the typed endpoints will not exist.
 */
export type AuthClient = ReturnType<typeof createClient>;

function createClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [organizationClient(), adminClient(), twoFactorClient()],
    fetchOptions: {
      // The session lives in an httpOnly cookie: it must ride along on every call,
      // and no token is ever readable from JavaScript.
      credentials: 'include',
    },
  });
}

export const AUTH_CLIENT = new InjectionToken<AuthClient>('AUTH_CLIENT', {
  providedIn: 'root',
  factory: () => createClient(inject(CORE_CONFIG).authUrl),
});
