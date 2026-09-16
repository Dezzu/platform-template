import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { toCookieHeader } from './helpers/auth';

const ORIGIN = 'http://localhost:4300';
const EMAIL = `e2e-validation-${Date.now()}@test.local`;
const PASSWORD = 'a-sufficiently-long-password';

describe('request validation (e2e)', () => {
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    app = await createTestApp();

    const signUp = await request(app.getHttpServer())
      .post('/api/auth/sign-up/email')
      .set('Origin', ORIGIN)
      .send({ email: EMAIL, password: PASSWORD, name: 'E2E' })
      .expect(200);

    cookie = toCookieHeader(signUp.headers['set-cookie'] as unknown as string[]);
  });

  afterAll(async () => {
    await db.delete(user).where(eq(user.email, EMAIL));
    await app.close();
  });

  describe('GET /plans', () => {
    it('is public and returns the envelope', async () => {
      const res = await request(app.getHttpServer()).get('/api/plans').expect(200);

      expect(res.body).toMatchObject({ success: true, message: null, messageCode: null });
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.data[0]).toHaveProperty('key');
    });
  });

  describe('authentication default', () => {
    it('rejects an undecorated route without a session', async () => {
      const res = await request(app.getHttpServer()).get('/api/me').expect(401);
      expect(res.body.messageCode).toBe('UNAUTHENTICATED');
      expect(res.body.success).toBe(false);
    });
  });

  /**
   * These are the regression guards that matter.
   *
   * `@Body({ schema })` only attaches the schema as parameter metadata — it does not
   * validate on its own. Without the globally registered StandardSchemaValidationPipe
   * the schema documents OpenAPI while invalid payloads reach the database untouched.
   * That failure is silent, so it needs a test rather than a comment.
   */
  describe('PATCH /me', () => {
    it('rejects values that violate the contract with 422 and field paths', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/me')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ name: '   ', image: 'not-a-url' })
        .expect(422);

      expect(res.body.messageCode).toBe('VALIDATION_FAILED');
      expect(res.body.data).toBeNull();
      expect(res.body.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'image',
        'name',
      ]);
    });

    it('rejects an empty patch', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/me')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({})
        .expect(422);

      expect(res.body.messageCode).toBe('VALIDATION_FAILED');
    });

    it('applies a valid update and does not persist rejected values', async () => {
      await request(app.getHttpServer())
        .patch('/api/me')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .send({ name: 'Updated Name' })
        .expect(200)
        .expect((res) => {
          expect(res.body.data.name).toBe('Updated Name');
        });

      const [row] = await db.select().from(user).where(eq(user.email, EMAIL));
      expect(row?.name).toBe('Updated Name');
      // The rejected image from the first test must never have been written.
      expect(row?.image).toBeNull();
    });
  });
});
