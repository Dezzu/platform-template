import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { auditLog, emailMessage, member, organization, session, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * The platform administration area — the one part of the API that crosses the tenancy
 * boundary on purpose.
 *
 * Which makes the rank rules the whole point. `platform.users.manage` says an admin may
 * change roles; read literally it also lets that admin grant themselves superadmin, at
 * which point the two roles are the same role and the distinction was decoration.
 */
describe('platform administration (e2e)', () => {
  let app: INestApplication;
  let superadmin: TestUser;
  let admin: TestUser;
  let plain: TestUser;
  let victim: TestUser;
  let orgA: string;

  const users: TestUser[] = [];
  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  /** Promotes directly: the endpoint under test is the one that must not allow it. */
  async function setPlatformRole(target: TestUser, role: string) {
    await db.update(user).set({ role }).where(eq(user.id, target.id));
  }

  beforeAll(async () => {
    app = await createTestApp();

    superadmin = await signUp(app, 'adm-super');
    admin = await signUp(app, 'adm-admin');
    plain = await signUp(app, 'adm-plain');
    victim = await signUp(app, 'adm-victim');
    users.push(superadmin, admin, plain, victim);

    await setPlatformRole(superadmin, 'superadmin');
    await setPlatformRole(admin, 'admin');

    orgA = await createOrganization(app, victim, 'AdminViewOrg');
  });

  afterAll(async () => {
    await db.delete(auditLog).where(
      inArray(
        auditLog.actorUserId,
        users.map((u) => u.id),
      ),
    );
    await db.delete(emailMessage).where(
      inArray(
        emailMessage.toEmail,
        users.map((u) => u.email),
      ),
    );
    await db.delete(member).where(inArray(member.organizationId, [orgA]));
    await db.delete(organization).where(inArray(organization.id, [orgA]));
    await db.delete(user).where(
      inArray(
        user.id,
        users.map((u) => u.id),
      ),
    );
    await app.close();
  });

  describe('who may enter at all', () => {
    it('refuses an ordinary user, however many organizations they own', async () => {
      // `plain` is an owner of nothing here, but being an org owner would not help:
      // these rights come from user.role, not from membership.
      await request(app.getHttpServer()).get('/api/admin/users').set(as(plain)).expect(403);
      await request(app.getHttpServer()).get('/api/admin/organizations').set(as(plain)).expect(403);
    });

    it('lets an admin list every account and every organization', async () => {
      const listed = await request(app.getHttpServer())
        .get('/api/admin/users')
        .set(as(admin))
        .expect(200);

      const emails = listed.body.data.items.map((u: { email: string }) => u.email);
      expect(emails).toContain(victim.email);

      const orgs = await request(app.getHttpServer())
        .get('/api/admin/organizations')
        .set(as(admin))
        .expect(200);

      const found = orgs.body.data.items.find((o: { id: string }) => o.id === orgA);
      expect(found?.memberCount).toBe(1);
    });

    it('searches across name and email', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/users')
        .query({ q: victim.email })
        .set(as(admin))
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].email).toBe(victim.email);
    });

    it('sorts by the column asked for, and ignores one it does not know', async () => {
      const byEmail = await request(app.getHttpServer())
        .get('/api/admin/users')
        .query({ sort: 'email', dir: 'asc', size: 200 })
        .set(as(admin))
        .expect(200);

      const emails = byEmail.body.data.items.map((u: { email: string }) => u.email);
      expect(emails).toEqual([...emails].sort());

      // An unknown sort field arrives from the client like any other. It must fall back
      // to the default rather than reach the query builder, where an ORDER BY built from
      // caller input is an injection point.
      const hostile = await request(app.getHttpServer())
        .get('/api/admin/users')
        .query({ sort: 'email; drop table "user"', dir: 'asc', size: 5 })
        .set(as(admin))
        .expect(200);

      expect(hostile.body.data.items.length).toBeGreaterThan(0);
    });

    it('sorts the organizations by the column asked for', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/admin/organizations')
        .query({ sort: 'name', dir: 'asc', size: 200 })
        .set(as(admin))
        .expect(200);

      const names = res.body.data.items.map((o: { name: string }) => o.name);
      expect(names).toEqual([...names].sort());
    });

    it('shows an account with the organizations it belongs to', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/admin/users/${victim.id}`)
        .set(as(admin))
        .expect(200);

      expect(res.body.data.organizations).toHaveLength(1);
      expect(res.body.data.organizations[0].id).toBe(orgA);
      expect(res.body.data.organizations[0].role).toBe('owner');
    });
  });

  describe('platform rank', () => {
    it('refuses an admin granting superadmin', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${victim.id}/role`)
        .set(as(admin))
        .send({ role: 'superadmin' })
        .expect(403);

      expect(res.body.messageCode).toBe('CANNOT_GRANT_HIGHER_ROLE');
    });

    it('refuses an admin acting on a superadmin', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/users/${superadmin.id}/role`)
        .set(as(admin))
        .send({ role: 'user' })
        .expect(403);

      await request(app.getHttpServer())
        .post(`/api/admin/users/${superadmin.id}/ban`)
        .set(as(admin))
        .send({ reason: 'nope' })
        .expect(403);
    });

    it('refuses anyone changing their own platform role', async () => {
      // Not symmetry: the last superadmin demoting themselves leaves a platform where
      // nobody can ever be promoted again.
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${superadmin.id}/role`)
        .set(as(superadmin))
        .send({ role: 'user' })
        .expect(409);

      expect(res.body.messageCode).toBe('CANNOT_MODIFY_SELF');
    });

    it('lets an admin promote an ordinary user, and records it', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/users/${victim.id}/role`)
        .set(as(admin))
        .send({ role: 'admin' })
        .expect(200);

      expect(res.body.data.role).toBe('admin');

      const [entry] = await db.select().from(auditLog).where(eq(auditLog.resourceId, victim.id));

      expect(entry?.action).toBe('platform.user.role_changed');
      // Null, because this belongs to no tenant: it is the platform acting.
      expect(entry?.organizationId).toBeNull();
      expect(entry?.actorUserId).toBe(admin.id);

      // Put it back, so the cases after this one see the fixture they expect.
      await setPlatformRole(victim, 'user');
    });
  });

  describe('support actions', () => {
    it('emails a reset link rather than setting a password', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/password-reset`)
        .set(as(admin))
        .expect(202);

      // Filtered by template: signing up already queued a verification email to the
      // same address, and it is the older of the two.
      const [queued] = await db
        .select()
        .from(emailMessage)
        .where(
          and(eq(emailMessage.toEmail, victim.email), eq(emailMessage.template, 'password-reset')),
        );

      expect(queued).toBeDefined();
      // The link is a bearer credential; the stored row must not carry it.
      expect(queued?.params).toMatchObject({ url: '[redacted]' });
    });

    it('bans, ends the sessions, and lifts the ban again', async () => {
      const before = await db.select().from(session).where(eq(session.userId, victim.id));
      expect(before.length).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/ban`)
        .set(as(admin))
        .send({ reason: 'spam' })
        .expect(204);

      const banned = await db.select().from(user).where(eq(user.id, victim.id));
      expect(banned[0]?.banned).toBe(true);
      expect(banned[0]?.banReason).toBe('spam');

      // A ban that leaves the existing session working is not a ban.
      const after = await db.select().from(session).where(eq(session.userId, victim.id));
      expect(after).toHaveLength(0);

      await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/unban`)
        .set(as(admin))
        .expect(204);

      const lifted = await db.select().from(user).where(eq(user.id, victim.id));
      expect(lifted[0]?.banned).toBe(false);
    });
  });
});
