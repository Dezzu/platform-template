import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { ORIGIN } from './helpers/auth';

/**
 * Pins the Better Auth error codes the sign-up and sign-in screens translate.
 *
 * These codes are a contract with the UI, and nothing else enforces it: if an upgrade
 * renames one, the mapping in the page silently falls through and every user sees
 * "something went wrong" instead of "that email is already registered". The bug is
 * invisible in code review and in the type system — only a test catches it.
 *
 * One of these was already wrong: the code is USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL,
 * not the USER_ALREADY_EXISTS that seemed obvious.
 */
describe('Better Auth error codes the UI depends on (e2e)', () => {
  let app: INestApplication;
  const email = `e2e-codes-${Date.now()}@test.local`;
  const password = 'a-sufficiently-long-password';

  beforeAll(async () => {
    app = await createTestApp();
    await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send({ email, password, name: 'Codes' })
      .expect(200);
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.email, email));
    await app.close();
  });

  it('gives a new account the configured platform role, not an elevated one', async () => {
    const [row] = await db.select().from(user).where(eq(user.email, email));

    // AUTH_DEFAULT_ROLE. 'user' carries no platform permissions at all, so a
    // misconfiguration that handed out 'admin' here would be a silent privilege
    // escalation for every registration.
    expect(row?.role).toBe('user');
  });

  it('signing up with an address already in use', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send({ email, password, name: 'Duplicate' });

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL');
  });

  it('signing in with the wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email, password: 'a-different-long-password' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('signing in with an unknown address gives the same answer as a wrong password', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-in/email')
      .set('Origin', ORIGIN)
      .send({ email: `nobody-${Date.now()}@test.local`, password });

    // Identical on purpose: telling the two apart turns the login form into an
    // account-existence oracle.
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_EMAIL_OR_PASSWORD');
  });

  it('rejects a password shorter than the configured minimum', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send({ email: `e2e-short-${Date.now()}@test.local`, password: 'short', name: 'Short' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PASSWORD_TOO_SHORT');
  });
});
