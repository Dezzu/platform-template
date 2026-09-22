import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { auditLog, member, organization, project, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * Reading the trail.
 *
 * The interesting cases are not "does the list render" but who may read it and what it
 * refuses to show: an audit log that leaks across tenants tells one customer what
 * another one did, and an audit log a plain member can read tells them who removed
 * whom.
 */
describe('audit trail (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser; // owner of org A
  let plain: TestUser; // member of org A
  let outsider: TestUser; // owner of org B
  let orgA: string;
  let orgB: string;

  const users: TestUser[] = [];
  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'audit-owner');
    plain = await signUp(app, 'audit-plain');
    outsider = await signUp(app, 'audit-outsider');
    users.push(owner, plain, outsider);

    orgA = await createOrganization(app, owner, 'AuditA');
    orgB = await createOrganization(app, outsider, 'AuditB');

    await db.insert(member).values({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: orgA,
      userId: plain.id,
      role: 'member',
      createdAt: new Date(),
    });

    // Something to read: a real mutation, recorded the way every mutation is.
    await request(app.getHttpServer())
      .post('/api/projects')
      .set(as(owner))
      .send({ name: `Audit ${Date.now()}` })
      .expect(201);
  });

  afterAll(async () => {
    const orgs = [orgA, orgB];
    await db.delete(auditLog).where(inArray(auditLog.organizationId, orgs));
    await db.delete(project).where(inArray(project.organizationId, orgs));
    await db.delete(member).where(inArray(member.organizationId, orgs));
    await db.delete(organization).where(inArray(organization.id, orgs));
    await db.delete(user).where(
      inArray(
        user.id,
        users.map((u) => u.id),
      ),
    );
    await app.close();
  });

  it('shows what happened, with who did it still readable', async () => {
    const res = await request(app.getHttpServer()).get('/api/audit').set(as(owner)).expect(200);

    const entry = res.body.data.items.find(
      (row: { action: string }) => row.action === 'project.created',
    );

    expect(entry).toBeDefined();
    expect(entry.actorEmail).toBe(owner.email);
    expect(entry.resourceType).toBe('project');
    // The change itself travels with the entry; the screen only shows it on request.
    expect(entry.after).toMatchObject({ name: expect.any(String) });
  });

  it('never shows one organization what another one did', async () => {
    const res = await request(app.getHttpServer()).get('/api/audit').set(as(outsider)).expect(200);

    // Org B did nothing, and must not inherit org A's history by asking.
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.meta.total).toBe(0);
  });

  it('refuses a plain member, who may read everything else about the tenant', async () => {
    // `member` holds every read permission except audit.read: who removed whom is not
    // everybody's business.
    await request(app.getHttpServer()).get('/api/audit').set(as(plain)).expect(403);
  });

  it('filters by action, and offers only the actions actually present', async () => {
    const facets = await request(app.getHttpServer())
      .get('/api/audit/facets')
      .set(as(owner))
      .expect(200);

    expect(facets.body.data.actions).toContain('project.created');

    const filtered = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ action: 'project.created' })
      .set(as(owner))
      .expect(200);

    expect(filtered.body.data.items.length).toBeGreaterThan(0);
    expect(
      filtered.body.data.items.every((row: { action: string }) => row.action === 'project.created'),
    ).toBe(true);

    const none = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ action: 'project.created.nonexistent' })
      .set(as(owner))
      .expect(200);

    expect(none.body.data.items).toHaveLength(0);
  });

  it('filters by date, excluding the upper bound', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const inRange = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ from: yesterday, to: tomorrow })
      .set(as(owner))
      .expect(200);
    expect(inRange.body.data.items.length).toBeGreaterThan(0);

    const before = await request(app.getHttpServer())
      .get('/api/audit')
      .query({ to: yesterday })
      .set(as(owner))
      .expect(200);
    expect(before.body.data.items).toHaveLength(0);
  });

  it('reads newest first, because that is the question people ask', async () => {
    await request(app.getHttpServer())
      .post('/api/projects')
      .set(as(owner))
      .send({ name: `Audit later ${Date.now()}` })
      .expect(201);

    const res = await request(app.getHttpServer()).get('/api/audit').set(as(owner)).expect(200);
    const dates = res.body.data.items.map((row: { createdAt: string }) =>
      Date.parse(row.createdAt),
    );

    expect(dates).toEqual([...dates].sort((a: number, b: number) => b - a));
  });

  it('keeps platform actions out of a tenant trail', async () => {
    // Platform entries carry a null organization on purpose; the tenant predicate
    // excludes them by construction rather than by remembering to.
    await db.insert(auditLog).values({
      organizationId: null,
      actorUserId: owner.id,
      action: 'platform.user.banned',
      resourceType: 'user',
      resourceId: plain.id,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer()).get('/api/audit').set(as(owner)).expect(200);

    expect(
      res.body.data.items.some((row: { action: string }) => row.action.startsWith('platform.')),
    ).toBe(false);

    await db.delete(auditLog).where(inArray(auditLog.actorUserId, [owner.id]));
  });
});
