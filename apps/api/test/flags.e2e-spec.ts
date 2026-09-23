import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { auditLog, emailMessage, featureFlag, member, organization, session, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * Feature flags: one switch, the same answer for everybody.
 *
 * There used to be a resolution order here — user override, organization override,
 * percentage rollout, then the global switch — and most of this file tested the cases
 * where two levels disagreed. All of it is gone: a flag is now a platform decision
 * about whether a feature is released, and a switch that could be true for one customer
 * and false for another is an entitlement, not a flag.
 *
 * What remains is what still has teeth: who may configure them, that the answer is the
 * same for every caller, and that the resolved set reaches the session.
 */
describe('feature flags (e2e)', () => {
  let app: INestApplication;
  let superadmin: TestUser;
  let plain: TestUser;
  let orgId: string;

  const users: TestUser[] = [];
  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  /** Unique per run: the suite shares one database with every other spec file. */
  const key = `e2e.flag-${Date.now()}`;

  const createFlag = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post('/api/flags/definitions').set(as(superadmin)).send(body);

  const patchFlag = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .patch(`/api/flags/definitions/${key}`)
      .set(as(superadmin))
      .send(body);

  /** What this user currently sees for the flag under test. */
  async function resolvedFor(u: TestUser): Promise<boolean | undefined> {
    const res = await request(app.getHttpServer()).get('/api/flags').set(as(u)).expect(200);
    return (res.body.data as Record<string, boolean>)[key];
  }

  beforeAll(async () => {
    app = await createTestApp();

    superadmin = await signUp(app, 'flag-super');
    plain = await signUp(app, 'flag-plain');
    users.push(superadmin, plain);

    await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, superadmin.id));

    // A second account in its own organization: the answer must be the same for it.
    orgId = await createOrganization(app, plain, 'FlagOrg');
  });

  afterAll(async () => {
    /**
     * Everything this spec created, including the accounts and the organization.
     * The suite shares one database with development: a spec that leaves its users
     * behind turns the administration screens into a list of `e2e-…@test.local`, and
     * turns the next reader's "who is this?" into wasted minutes.
     */
    const ids = users.map((u) => u.id);

    await db.delete(featureFlag).where(like(featureFlag.key, 'e2e.flag-%'));
    await db.delete(auditLog).where(inArray(auditLog.actorUserId, ids));
    await db.delete(emailMessage).where(
      inArray(
        emailMessage.toEmail,
        users.map((u) => u.email),
      ),
    );
    await db.delete(session).where(inArray(session.userId, ids));
    await db.delete(member).where(eq(member.organizationId, orgId));
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(user).where(inArray(user.id, ids));
    await app.close();
  });

  describe('who may configure them', () => {
    it('refuses the definitions to an account without platform.flags.manage', async () => {
      await request(app.getHttpServer())
        .get('/api/flags/definitions')
        .set(as(plain))
        .expect(403)
        .expect((res) => {
          expect(res.body.messageCode).toBe('FORBIDDEN_MISSING_PERMISSION');
        });
    });

    it('refuses to let that account create one', async () => {
      await request(app.getHttpServer())
        .post('/api/flags/definitions')
        .set(as(plain))
        .send({ key: 'e2e.flag-nope' })
        .expect(403);
    });

    it('still answers the resolved set to any signed-in caller', async () => {
      // The shell needs this on every boot: it is what decides which menu entries
      // exist. Gating it behind an administration permission would mean nobody but a
      // superadmin ever has a flag applied to them.
      await request(app.getHttpServer()).get('/api/flags').set(as(plain)).expect(200);
    });

    it('rejects a key that is not a flag key', async () => {
      await createFlag({ key: 'Not A Key' }).expect(422);
    });
  });

  describe('what the switch does', () => {
    it('creates the flag off, and it resolves off', async () => {
      await createFlag({ key, description: 'global switch', enabled: false }).expect(201);
      expect(await resolvedFor(plain)).toBe(false);
    });

    it('refuses a second flag with the same key', async () => {
      await createFlag({ key })
        .expect(409)
        .expect((res) => {
          expect(res.body.messageCode).toBe('FLAG_ALREADY_EXISTS');
        });
    });

    it('resolves on for everybody once the switch is on', async () => {
      await patchFlag({ enabled: true }).expect(200);

      // Two different accounts in two different organizations. That they agree is the
      // whole property now: there is no level at which they could disagree.
      expect(await resolvedFor(plain)).toBe(true);
      expect(await resolvedFor(superadmin)).toBe(true);
    });

    it('resolves off for everybody once it is switched back', async () => {
      await patchFlag({ enabled: false }).expect(200);
      expect(await resolvedFor(plain)).toBe(false);
      expect(await resolvedFor(superadmin)).toBe(false);
    });

    it('refuses a rollout percentage, which is no longer a thing a flag has', async () => {
      // Belt and braces on the contract: a client still sending the old field should be
      // told, not silently ignored.
      await patchFlag({ rolloutPercent: 50 }).expect(422);
    });
  });

  describe('the session payload', () => {
    it('carries the resolved set, so the shell needs no second call', async () => {
      await patchFlag({ enabled: true }).expect(200);

      const res = await request(app.getHttpServer()).get('/api/me').set(as(plain)).expect(200);
      expect(res.body.data.flags[key]).toBe(true);
    });
  });

  describe('deletion', () => {
    it('drops out of the resolved set entirely', async () => {
      await request(app.getHttpServer())
        .delete(`/api/flags/definitions/${key}`)
        .set(as(superadmin))
        .expect(204);

      /**
       * Absent, not false — and the difference matters: every guard reads an unknown
       * key as off, so a deleted flag closes the feature rather than opening it.
       */
      expect(await resolvedFor(plain)).toBeUndefined();

      await request(app.getHttpServer())
        .get(`/api/flags/definitions/${key}`)
        .set(as(superadmin))
        .expect(404)
        .expect((res) => {
          expect(res.body.messageCode).toBe('FLAG_NOT_FOUND');
        });
    });
  });
});
