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
  return values
    .map((c) => c.split(';')[0]?.trim())
    .filter((c): c is string => Boolean(c))
    .join('; ');
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
