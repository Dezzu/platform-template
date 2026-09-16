import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { auditLog, member, organization, project, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * The most important test in the template.
 *
 * Multi-tenant leaks are silent: nothing crashes, the wrong customer simply sees data
 * that is not theirs. These cases are the reason TenantRepository demands an OrgScope
 * instead of trusting callers to remember a WHERE clause.
 */
describe('tenant isolation and permissions (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser; // owner of org A
  let outsider: TestUser; // owner of org B — must never see org A
  let plain: TestUser; // plain member of org A
  let orgA: string;
  let orgB: string;
  let projectId: string;

  const users: TestUser[] = [];

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'owner');
    outsider = await signUp(app, 'outsider');
    plain = await signUp(app, 'member');
    users.push(owner, outsider, plain);

    orgA = await createOrganization(app, owner, 'OrgA');
    orgB = await createOrganization(app, outsider, 'OrgB');

    // Added directly rather than through the invitation flow, which needs email.
    await db.insert(member).values({
      // Random suffix, not just a timestamp: two inserts in the same millisecond
      // would otherwise collide on the primary key.
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: orgA,
      userId: plain.id,
      role: 'member',
      createdAt: new Date(),
    });

    const created = await request(app.getHttpServer())
      .post('/api/projects')
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .send({ name: 'Secret project of org A' })
      .expect(201);

    projectId = created.body.data.id as string;
  });

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.organizationId, [orgA, orgB]));
    await db.delete(project).where(inArray(project.organizationId, [orgA, orgB]));
    await db.delete(organization).where(inArray(organization.id, [orgA, orgB]));
    await db.delete(user).where(
      inArray(
        user.id,
        users.map((u) => u.id),
      ),
    );
    await app.close();
  });

  describe('roles on joining', () => {
    it('makes the creator of an organization its owner', async () => {
      const [row] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, orgA), eq(member.userId, owner.id)));

      // ORG_CREATOR_ROLE.
      expect(row?.role).toBe('owner');
    });

    it('gives someone who joins later the default role', async () => {
      const [row] = await db
        .select()
        .from(member)
        .where(and(eq(member.organizationId, orgA), eq(member.userId, plain.id)));

      // ORG_DEFAULT_ROLE.
      expect(row?.role).toBe('member');
    });
  });

  describe('a user from another organization', () => {
    it('cannot read the project by id — and gets 404, not 403', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/projects/${projectId}`)
        .set('Cookie', outsider.cookie)
        .expect(404);

      // 403 would confirm the id exists. Absence and inaccessibility must look alike.
      expect(res.body.messageCode).toBe('NOT_FOUND');
    });

    it('does not see it in the list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/projects')
        .set('Cookie', outsider.cookie)
        .expect(200);

      expect(res.body.data.items).toHaveLength(0);
      expect(res.body.data.meta.total).toBe(0);
    });

    it('cannot update it', async () => {
      await request(app.getHttpServer())
        .patch(`/api/projects/${projectId}`)
        .set('Cookie', outsider.cookie)
        .set('Origin', ORIGIN)
        .send({ name: 'hijacked' })
        .expect(404);

      const [row] = await db.select().from(project).where(eq(project.id, projectId));
      expect(row?.name).toBe('Secret project of org A');
    });

    it('cannot delete it', async () => {
      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Cookie', outsider.cookie)
        .set('Origin', ORIGIN)
        .expect(404);

      const rows = await db.select().from(project).where(eq(project.id, projectId));
      expect(rows).toHaveLength(1);
    });

    it('cannot reach org A by forging the X-Organization-Id header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/projects')
        .set('Cookie', outsider.cookie)
        .set('X-Organization-Id', orgA)
        .expect(404);

      expect(res.body.messageCode).toBe('ORGANIZATION_NOT_FOUND');
    });
  });

  describe('a plain member of the same organization', () => {
    it('can read', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/projects')
        .set('Cookie', plain.cookie)
        .expect(200);

      expect(res.body.data.items).toHaveLength(1);
    });

    it('cannot create — 403 listing the missing permission', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/projects')
        .set('Cookie', plain.cookie)
        .set('Origin', ORIGIN)
        .send({ name: 'should not exist' })
        .expect(403);

      expect(res.body.messageCode).toBe('FORBIDDEN_MISSING_PERMISSION');
      expect(res.body.details.missing).toContain('projects.manage');
    });

    it('cannot delete', async () => {
      const res = await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Cookie', plain.cookie)
        .set('Origin', ORIGIN)
        .expect(403);

      expect(res.body.details.missing).toContain('projects.delete');
    });
  });

  describe('audit trail', () => {
    it('recorded the creation with actor, tenant and request id', async () => {
      const [entry] = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, orgA), eq(auditLog.action, 'project.created')));

      expect(entry).toBeDefined();
      expect(entry?.actorUserId).toBe(owner.id);
      expect(entry?.resourceId).toBe(projectId);
      // Populated from the ambient request context, not passed by the service.
      expect(entry?.requestId).toBeTruthy();
      expect(entry?.ip).toBeTruthy();
    });

    it('records nothing when the transaction rolls back', async () => {
      // A duplicate name aborts the transaction after the insert would have happened.
      await request(app.getHttpServer())
        .post('/api/projects')
        .set('Cookie', owner.cookie)
        .set('Origin', ORIGIN)
        .send({ name: 'Secret project of org A' })
        .expect(409);

      const entries = await db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.organizationId, orgA), eq(auditLog.action, 'project.created')));

      expect(entries).toHaveLength(1);
    });
  });

  describe('the owner', () => {
    it('can update and delete their own project', async () => {
      await request(app.getHttpServer())
        .patch(`/api/projects/${projectId}`)
        .set('Cookie', owner.cookie)
        .set('Origin', ORIGIN)
        .send({ status: 'archived' })
        .expect(200)
        .expect((res) => expect(res.body.data.status).toBe('archived'));

      await request(app.getHttpServer())
        .delete(`/api/projects/${projectId}`)
        .set('Cookie', owner.cookie)
        .set('Origin', ORIGIN)
        .expect(204);
    });
  });
});
