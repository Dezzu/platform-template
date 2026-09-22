import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray, like } from 'drizzle-orm';
import { auditLog, emailMessage, featureFlag, member, organization, session, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * Feature flags, and above all the order in which they resolve:
 *
 *   user override -> organization override -> percentage rollout -> global `enabled`
 *
 * Each step exists to beat the one after it, so the tests that matter are the ones
 * where two levels disagree. A resolution that merely returns the global value is
 * indistinguishable from a broken one whenever nothing contradicts it.
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

  const setOverride = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .put(`/api/flags/definitions/${key}/overrides`)
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

    // The plain user's organization: the level an override targets most often.
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

  describe('resolution order', () => {
    it('creates the flag off, and it resolves off', async () => {
      await createFlag({ key, description: 'resolution order', enabled: false }).expect(201);
      expect(await resolvedFor(plain)).toBe(false);
    });

    it('refuses a second flag with the same key', async () => {
      await createFlag({ key })
        .expect(409)
        .expect((res) => {
          expect(res.body.messageCode).toBe('FLAG_ALREADY_EXISTS');
        });
    });

    it('resolves on once the global switch is on', async () => {
      await patchFlag({ enabled: true }).expect(200);
      expect(await resolvedFor(plain)).toBe(true);
    });

    it('lets an organization override beat the global switch', async () => {
      await setOverride({ organizationId: orgId, enabled: false }).expect(200);
      expect(await resolvedFor(plain)).toBe(false);

      // Nobody else is affected: an override is an exception, not a new default.
      expect(await resolvedFor(superadmin)).toBe(true);
    });

    it('lets a user override beat the organization one', async () => {
      await setOverride({ userId: plain.id, enabled: true }).expect(200);
      expect(await resolvedFor(plain)).toBe(true);
    });

    it('sets rather than duplicates: the same subject twice is one override', async () => {
      await setOverride({ userId: plain.id, enabled: false }).expect(200);
      expect(await resolvedFor(plain)).toBe(false);

      const res = await request(app.getHttpServer())
        .get(`/api/flags/definitions/${key}/overrides`)
        .set(as(superadmin))
        .expect(200);

      const overrides = res.body.data as { userId: string | null }[];
      expect(overrides.filter((o) => o.userId === plain.id)).toHaveLength(1);
    });

    it('refuses an override that names both a user and an organization', async () => {
      await setOverride({ userId: plain.id, organizationId: orgId, enabled: true }).expect(422);
    });

    it('refuses an override for a subject that does not exist', async () => {
      await setOverride({ userId: 'no-such-user', enabled: true }).expect(404);
    });

    it('falls back to the global answer once the overrides are dropped', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/flags/definitions/${key}/overrides`)
        .set(as(superadmin))
        .expect(200);

      for (const override of res.body.data as { id: string }[]) {
        await request(app.getHttpServer())
          .delete(`/api/flags/definitions/${key}/overrides/${override.id}`)
          .set(as(superadmin))
          .expect(204);
      }

      expect(await resolvedFor(plain)).toBe(true);
    });
  });

  describe('percentage rollout', () => {
    it('is consulted only while the global switch is off', async () => {
      // 0% and enabled: on. If the percentage could subtract from `enabled`, shipping
      // to everyone would be impossible without first clearing the rollout.
      await patchFlag({ enabled: true, rolloutPercent: 0 }).expect(200);
      expect(await resolvedFor(plain)).toBe(true);
    });

    it('is off for everybody at 0%', async () => {
      await patchFlag({ enabled: false, rolloutPercent: 0 }).expect(200);
      expect(await resolvedFor(plain)).toBe(false);
    });

    it('is on for everybody at 100%', async () => {
      await patchFlag({ rolloutPercent: 100 }).expect(200);
      expect(await resolvedFor(plain)).toBe(true);
    });

    it('gives the same answer twice: the bucket is a hash, not a draw', async () => {
      await patchFlag({ rolloutPercent: 50 }).expect(200);

      const first = await resolvedFor(plain);
      // Second call, cache dropped by the mutation in between, same answer expected.
      await patchFlag({ description: 'stable bucket' }).expect(200);
      expect(await resolvedFor(plain)).toBe(first);
    });

    it('rejects a percentage outside 0-100', async () => {
      await patchFlag({ rolloutPercent: 101 }).expect(422);
    });
  });

  describe('the session payload', () => {
    it('carries the resolved set, so the shell needs no second call', async () => {
      await patchFlag({ enabled: true, rolloutPercent: 0 }).expect(200);

      const res = await request(app.getHttpServer()).get('/api/me').set(as(plain)).expect(200);
      expect(res.body.data.flags[key]).toBe(true);
    });
  });

  describe('deletion', () => {
    it('takes the overrides with it and drops out of the resolved set', async () => {
      await setOverride({ organizationId: orgId, enabled: false }).expect(200);

      await request(app.getHttpServer())
        .delete(`/api/flags/definitions/${key}`)
        .set(as(superadmin))
        .expect(204);

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
