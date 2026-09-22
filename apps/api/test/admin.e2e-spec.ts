import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { auditLog, emailMessage, member, organization, session, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, toCookieHeader, type TestUser } from './helpers/auth';

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

    it('narrows the account list to one organization, with the role inside it', async () => {
      const scoped = await request(app.getHttpServer())
        .get('/api/admin/users')
        .query({ organizationId: orgA, size: 200 })
        .set(as(admin))
        .expect(200);

      const emails = scoped.body.data.items.map((u: { email: string }) => u.email);
      expect(emails).toEqual([victim.email]);
      expect(scoped.body.data.meta.total).toBe(1);
      // The role only has a meaning once the list is scoped to one tenant.
      expect(scoped.body.data.items[0].organizationRole).toBe('owner');

      const unscoped = await request(app.getHttpServer())
        .get('/api/admin/users')
        .query({ size: 200 })
        .set(as(admin))
        .expect(200);

      expect(unscoped.body.data.items.length).toBeGreaterThan(1);
      expect(unscoped.body.data.items[0].organizationRole).toBeNull();
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

  describe('roles inside an organization', () => {
    it('changes a role from outside the organization, and records the tenant', async () => {
      const newcomer = await signUp(app, 'adm-newcomer');
      users.push(newcomer);
      await db.insert(member).values({
        id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        organizationId: orgA,
        userId: newcomer.id,
        role: 'member',
        createdAt: new Date(),
      });

      await request(app.getHttpServer())
        .patch(`/api/admin/organizations/${orgA}/members/${newcomer.id}/role`)
        .set(as(admin))
        .send({ role: 'admin' })
        .expect(204);

      const [updated] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, orgA), eq(member.userId, newcomer.id)));
      expect(updated?.role).toBe('admin');

      // Scoped to the row this case created. Querying by action alone reads whatever
      // else is in the shared development database — including a change somebody made
      // by hand in the browser, which is exactly how this failed once.
      const [entry] = await db
        .select()
        .from(auditLog)
        .where(
          and(
            eq(auditLog.action, 'platform.member.role_changed'),
            eq(auditLog.resourceId, updated?.id ?? ''),
          ),
        );
      // Set, unlike the other platform actions: this one does belong to a tenant, even
      // though the person doing it is not a member of it.
      expect(entry?.organizationId).toBe(orgA);
      expect(entry?.actorUserId).toBe(admin.id);
    });

    it('refuses to demote the last owner', async () => {
      // Better Auth guards this on the members screen, but a platform admin has no
      // membership here and none of that code is on this path.
      const res = await request(app.getHttpServer())
        .patch(`/api/admin/organizations/${orgA}/members/${victim.id}/role`)
        .set(as(admin))
        .send({ role: 'member' })
        .expect(409);

      expect(res.body.messageCode).toBe('ORGANIZATION_LAST_OWNER');

      const [unchanged] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, orgA), eq(member.userId, victim.id)));
      expect(unchanged?.role).toBe('owner');
    });

    it('answers 404 for someone who is not a member of that organization', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/organizations/${orgA}/members/${plain.id}/role`)
        .set(as(admin))
        .send({ role: 'admin' })
        .expect(404);
    });

    it('refuses an ordinary user outright', async () => {
      await request(app.getHttpServer())
        .patch(`/api/admin/organizations/${orgA}/members/${victim.id}/role`)
        .set(as(plain))
        .send({ role: 'member' })
        .expect(403);
    });
  });

  describe('impersonation', () => {
    it('refuses an admin: becoming somebody else is a superadmin power', async () => {
      // `platform.impersonate` is deliberately absent from the support role. Its blast
      // radius is that person's entire account, not one setting of theirs.
      await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/impersonate`)
        .set(as(admin))
        .expect(403);
    });

    it('hands the browser a session for the other account, and lets it back out', async () => {
      const entered = await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/impersonate`)
        .set(as(superadmin))
        .expect(204);

      // Without the cookie the call succeeds server-side and the browser stays itself.
      const cookie = toCookieHeader(entered.headers['set-cookie'] as unknown as string[]);
      expect(cookie).not.toBe('');

      const who = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .expect(200);

      expect(who.body.data.user.email).toBe(victim.email);
      // Reported so the interface can say so permanently and offer the way out.
      expect(who.body.data.impersonating).toBe(true);

      // The exit asks for no permission of ours: this session belongs to somebody who
      // does not hold `platform.impersonate`, and requiring it would lock the
      // administrator inside the account they stepped into.
      const left = await request(app.getHttpServer())
        .post('/api/admin/stop-impersonating')
        .set('Cookie', cookie)
        .set('Origin', ORIGIN)
        .expect(204);

      const back = toCookieHeader(left.headers['set-cookie'] as unknown as string[]);
      const again = await request(app.getHttpServer())
        .get('/api/me')
        .set('Cookie', back)
        .set('Origin', ORIGIN)
        .expect(200);

      expect(again.body.data.user.email).toBe(superadmin.email);
      expect(again.body.data.impersonating).toBe(false);
    });

    it('records both people, on the way in and on the way out', async () => {
      /**
       * Scoped to this run's accounts, not to the action alone.
       *
       * Without the second predicate the query returns every impersonation ever
       * recorded in the development database — including one an actual person
       * performed from the interface — and `find` then answers with whichever came
       * first. That failed exactly that way, and the row it found was real.
       */
      const entries = await db
        .select()
        .from(auditLog)
        .where(
          and(
            inArray(auditLog.action, [
              'platform.user.impersonated',
              'platform.user.impersonation_stopped',
            ]),
            inArray(auditLog.actorUserId, [superadmin.id, victim.id]),
          ),
        );

      const entered = entries.find((e) => e.action === 'platform.user.impersonated');
      expect(entered?.actorUserId).toBe(superadmin.id);
      expect(entered?.resourceId).toBe(victim.id);

      // On the way out the actor is whoever the session belonged to, with the
      // impersonator named alongside — exactly as in every entry written meanwhile.
      const stopped = entries.find((e) => e.action === 'platform.user.impersonation_stopped');
      expect(stopped?.actorUserId).toBe(victim.id);
      expect(stopped?.impersonatorUserId).toBe(superadmin.id);
    });

    it('refuses to stop what is not an impersonation', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/admin/stop-impersonating')
        .set(as(superadmin))
        .expect(409);

      expect(res.body.messageCode).toBe('CONFLICT');
    });

    it('refuses impersonating yourself', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/admin/users/${superadmin.id}/impersonate`)
        .set(as(superadmin))
        .expect(409);

      expect(res.body.messageCode).toBe('CANNOT_MODIFY_SELF');
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

    it('re-sends the verification email, and refuses once the address is verified', async () => {
      await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/verification-email`)
        .set(as(admin))
        .expect(202);

      const queued = await db
        .select()
        .from(emailMessage)
        .where(
          and(
            eq(emailMessage.toEmail, victim.email),
            eq(emailMessage.template, 'email-verification'),
          ),
        );
      // One from signing up, one from this call.
      expect(queued.length).toBeGreaterThanOrEqual(2);

      await db.update(user).set({ emailVerified: true }).where(eq(user.id, victim.id));

      const res = await request(app.getHttpServer())
        .post(`/api/admin/users/${victim.id}/verification-email`)
        .set(as(admin))
        .expect(409);
      expect(res.body.messageCode).toBe('CONFLICT');

      await db.update(user).set({ emailVerified: false }).where(eq(user.id, victim.id));
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
