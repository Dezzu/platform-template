import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { auditLog, emailMessage, invitation, member, organization, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * Membership, and the rules that keep an organization from being taken over.
 *
 * The permission catalogue says who may touch members at all. These cases are about
 * the second question it does not answer — *which* members — because "admin may remove
 * members" read literally includes removing the owner.
 */
describe('members and invitations (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser; // owner of org A
  let admin: TestUser; // admin of org A
  let plain: TestUser; // member of org A
  let outsider: TestUser; // owner of org B
  let orgA: string;
  let orgB: string;

  const users: TestUser[] = [];
  const membershipIds: Record<string, string> = {};
  /** Organizations created inside a single case, torn down with the rest. */
  const scratchOrgs: string[] = [];

  /** Adds a membership directly: the invitation flow is what several cases exercise. */
  async function addMember(organizationId: string, target: TestUser, role: string) {
    const id = `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db
      .insert(member)
      .values({ id, organizationId, userId: target.id, role, createdAt: new Date() });
    return id;
  }

  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'mem-owner');
    admin = await signUp(app, 'mem-admin');
    plain = await signUp(app, 'mem-plain');
    outsider = await signUp(app, 'mem-outsider');
    users.push(owner, admin, plain, outsider);

    orgA = await createOrganization(app, owner, 'MembersA');
    orgB = await createOrganization(app, outsider, 'MembersB');

    membershipIds.admin = await addMember(orgA, admin, 'admin');
    membershipIds.plain = await addMember(orgA, plain, 'member');
  });

  afterAll(async () => {
    const orgs = [orgA, orgB, ...scratchOrgs];
    await db.delete(auditLog).where(inArray(auditLog.organizationId, orgs));
    await db.delete(invitation).where(inArray(invitation.organizationId, orgs));
    await db.delete(member).where(inArray(member.organizationId, orgs));
    await db.delete(organization).where(inArray(organization.id, orgs));
    await db.delete(emailMessage).where(
      inArray(
        emailMessage.toEmail,
        users.map((u) => u.email),
      ),
    );
    await db.delete(user).where(
      inArray(
        user.id,
        users.map((u) => u.id),
      ),
    );
    await app.close();
  });

  describe('listing', () => {
    it('shows the members of the active organization, with their user attached', async () => {
      const res = await request(app.getHttpServer()).get('/api/members').set(as(owner)).expect(200);

      const emails = res.body.data.items.map((m: { user: { email: string } }) => m.user.email);
      expect(emails).toContain(owner.email);
      expect(emails).toContain(admin.email);
      expect(emails).toContain(plain.email);
      expect(res.body.data.meta.total).toBe(3);
    });

    it('never shows another organization its members', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/members')
        .set(as(outsider))
        .expect(200);

      const emails = res.body.data.items.map((m: { user: { email: string } }) => m.user.email);
      expect(emails).toEqual([outsider.email]);
    });

    it('refuses a plain member the invitation list', async () => {
      // `member` holds members.read, so the list itself is allowed…
      await request(app.getHttpServer()).get('/api/members').set(as(plain)).expect(200);
      // …but inviting is not.
      await request(app.getHttpServer())
        .post('/api/members/invitations')
        .set(as(plain))
        .send({ email: 'nobody@test.local', role: 'member' })
        .expect(403);
    });
  });

  describe('rank rules', () => {
    it('refuses an admin who tries to invite an owner', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/members/invitations')
        .set(as(admin))
        .send({ email: `escalate-${Date.now()}@test.local`, role: 'owner' })
        .expect(403);

      // Otherwise an admin promotes themselves by proxy, via someone they control.
      expect(res.body.messageCode).toBe('CANNOT_GRANT_HIGHER_ROLE');
    });

    it('refuses an admin who tries to remove the owner', async () => {
      const list = await request(app.getHttpServer())
        .get('/api/members')
        .set(as(owner))
        .expect(200);
      const ownerMembership = list.body.data.items.find(
        (m: { user: { email: string } }) => m.user.email === owner.email,
      );

      await request(app.getHttpServer())
        .delete(`/api/members/${ownerMembership.id}`)
        .set(as(admin))
        .expect(403);
    });

    it('lets an owner step down while another owner remains', async () => {
      // A dedicated organization: these cases mutate roles, and doing that to the
      // shared fixture is how one failing test takes the rest of the suite with it.
      const alice = await signUp(app, 'step-alice');
      const bob = await signUp(app, 'step-bob');
      users.push(alice, bob);

      const org = await createOrganization(app, alice, 'StepDown');
      scratchOrgs.push(org);
      await addMember(org, bob, 'owner');

      const list = await request(app.getHttpServer()).get('/api/members').set(as(alice));
      const aliceMembership = list.body.data.items.find(
        (m: { user: { email: string } }) => m.user.email === alice.email,
      );

      const res = await request(app.getHttpServer())
        .patch(`/api/members/${aliceMembership.id}`)
        .set(as(alice))
        .send({ role: 'member' })
        .expect(200);

      // Only ever a demotion: the rank rule makes granting yourself more impossible.
      expect(res.body.data.role).toBe('member');
    });

    it('refuses the last owner stepping down, which would orphan the organization', async () => {
      const solo = await signUp(app, 'step-solo');
      users.push(solo);

      const org = await createOrganization(app, solo, 'SoleOwner');
      scratchOrgs.push(org);

      const list = await request(app.getHttpServer()).get('/api/members').set(as(solo));
      const membership = list.body.data.items[0];

      const res = await request(app.getHttpServer())
        .patch(`/api/members/${membership.id}`)
        .set(as(solo))
        .send({ role: 'member' })
        .expect(409);

      expect(res.body.messageCode).toBe('ORGANIZATION_LAST_OWNER');
    });

    it('refuses a member promoting themselves', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/members/${membershipIds.plain}`)
        .set(as(plain))
        .send({ role: 'owner' })
        .expect(403);

      // Blocked before the rank rule even runs: a plain member holds no members.manage.
      expect(res.body.messageCode).toBe('FORBIDDEN_MISSING_PERMISSION');
    });

    it('refuses an admin promoting themselves to owner', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/members/${membershipIds.admin}`)
        .set(as(admin))
        .send({ role: 'owner' })
        .expect(403);

      expect(res.body.messageCode).toBe('CANNOT_GRANT_HIGHER_ROLE');
    });

    it('refuses removing yourself, which is a different door', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/members/${membershipIds.admin}`)
        .set(as(admin))
        .expect(409);

      expect(res.body.messageCode).toBe('CANNOT_MODIFY_SELF');
    });
  });

  describe('invitation round trip', () => {
    it('invites, emails, previews and accepts', async () => {
      const newcomer = await signUp(app, 'mem-newcomer');
      users.push(newcomer);

      const invited = await request(app.getHttpServer())
        .post('/api/members/invitations')
        .set(as(owner))
        .send({ email: newcomer.email, role: 'member' })
        .expect(201);

      const invitationId = invited.body.data.id as string;
      expect(invited.body.data.status).toBe('pending');
      expect(invited.body.data.organizationId).toBe(orgA);

      // Queued through MailService, not sent inline — the phase 8 contract.
      const [queued] = await db
        .select()
        .from(emailMessage)
        .where(
          and(
            eq(emailMessage.toEmail, newcomer.email),
            eq(emailMessage.template, 'organization-invitation'),
          ),
        );
      expect(queued).toBeDefined();
      expect(queued?.organizationId).toBe(orgA);

      // Pending invitations are visible to whoever may read members.
      const pending = await request(app.getHttpServer())
        .get('/api/members/invitations')
        .set(as(owner))
        .expect(200);
      expect(pending.body.data.map((i: { id: string }) => i.id)).toContain(invitationId);

      // The recipient can read it without being a member yet…
      const preview = await request(app.getHttpServer())
        .get(`/api/invitations/${invitationId}`)
        .set(as(newcomer))
        .expect(200);
      expect(preview.body.data.organizationName).toBe('MembersA');
      expect(preview.body.data.email).toBe(newcomer.email);

      // …but nobody else can, however well they guess the id.
      await request(app.getHttpServer())
        .get(`/api/invitations/${invitationId}`)
        .set(as(outsider))
        .expect((res) => {
          expect(res.status).toBeGreaterThanOrEqual(400);
        });

      await request(app.getHttpServer())
        .post(`/api/invitations/${invitationId}/accept`)
        .set(as(newcomer))
        .expect(200);

      const [joined] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, orgA), eq(member.userId, newcomer.id)));
      expect(joined?.role).toBe('member');

      const entries = await db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.organizationId, orgA));
      const actions = entries.map((e) => e.action);
      expect(actions).toContain('member.invited');
      expect(actions).toContain('invitation.accepted');
    });

    it('does not let another organization cancel an invitation it cannot see', async () => {
      const invited = await request(app.getHttpServer())
        .post('/api/members/invitations')
        .set(as(owner))
        .send({ email: `cross-${Date.now()}@test.local`, role: 'member' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/members/invitations/${invited.body.data.id}`)
        .set(as(outsider))
        .expect((res) => {
          expect(res.status).toBeGreaterThanOrEqual(400);
        });
    });
  });
});
