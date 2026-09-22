import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/** Origin must be in AUTH_TRUSTED_ORIGINS or Better Auth rejects the request. */
export const ORIGIN = 'http://localhost:4300';
const PASSWORD = 'a-sufficiently-long-password';

/**
 * Builds a Cookie header from Set-Cookie responses.
 *
 * Joining raw Set-Cookie values would drag their attributes (Path, HttpOnly,
 * SameSite, Expires) into the request header, producing something the server parses
 * as garbage — which surfaces as a confusing 401 rather than a parse error. Only the
 * name=value pair belongs in a Cookie header.
 */
export function toCookieHeader(setCookie: string[] | string | undefined): string {
  const values = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];

  /**
   * Last one wins, and an empty value clears the cookie — which is what a browser
   * does, and what a naive join does not.
   *
   * It matters as soon as one response both clears and sets the same cookie, as
   * impersonation does: Better Auth expires `session_token` and then issues a new one
   * in the same response. Concatenating them sends `session_token=` first, the server
   * reads that, and a perfectly good login looks like a 401.
   */
  const jar = new Map<string, string>();
  for (const raw of values) {
    const pair = raw.split(';')[0]?.trim();
    if (!pair) continue;

    const separator = pair.indexOf('=');
    if (separator < 0) continue;

    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);

    if (value === '') jar.delete(name);
    else jar.set(name, value);
  }

  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

export interface TestUser {
  email: string;
  id: string;
  cookie: string;
}

export async function signUp(app: INestApplication, label: string): Promise<TestUser> {
  const email = `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`;

  const res = await request(app.getHttpServer())
    .post('/api/auth/sign-up/email')
    .set('Origin', ORIGIN)
    .send({ email, password: PASSWORD, name: label })
    .expect(200);

  return {
    email,
    id: res.body.user.id as string,
    cookie: toCookieHeader(res.headers['set-cookie'] as unknown as string[]),
  };
}

/** Creates an organization; the caller becomes its owner and it becomes their active one. */
export async function createOrganization(
  app: INestApplication,
  user: TestUser,
  name: string,
): Promise<string> {
  const slug = `${name.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const res = await request(app.getHttpServer())
    .post('/api/auth/organization/create')
    .set('Cookie', user.cookie)
    .set('Origin', ORIGIN)
    .send({ name, slug })
    .expect(200);

  return res.body.id as string;
}
