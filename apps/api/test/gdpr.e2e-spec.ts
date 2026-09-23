import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import {
  deletionRequest,
  emailMessage,
  gdprExportRequest,
  member,
  organization,
  session,
  subscription,
  user,
} from '@app/db';
import { db } from '../src/database/db';
import { GdprExportService } from '../src/modules/gdpr/gdpr-export.service';
import { S3Service } from '../src/storage/s3.service';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * The two rights, and the four ways getting them wrong is expensive.
 *
 * An export archive is every piece of personal data the product holds about somebody,
 * so a download reachable by the wrong session is the worst single leak in here — it
 * is checked from both directions: another member of the same tenant, and a stranger.
 *
 * An erasure is irreversible, so what is checked is that it *does not* happen: not
 * twice, not by somebody who lacks the permission, not while money still points at the
 * subject, and not without a way to call it off.
 */
describe('gdpr (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser;
  let colleague: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let otherOrgId: string;

  const users: TestUser[] = [];
  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'gdpr-owner');
    colleague = await signUp(app, 'gdpr-colleague');
    outsider = await signUp(app, 'gdpr-outsider');
    users.push(owner, colleague, outsider);

    orgId = await createOrganization(app, owner, 'GdprOrg');
    otherOrgId = await createOrganization(app, outsider, 'GdprOther');

    await db.insert(member).values({
      id: `m-gdpr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: orgId,
      userId: colleague.id,
      role: 'member',
      createdAt: new Date(),
    });
  });

  /** A request in whatever state the test needs, without going through the queue. */
  async function givenExport(of: TestUser, status: 'pending' | 'processing'): Promise<string> {
    const [row] = await db
      .insert(gdprExportRequest)
      .values({ userId: of.id, scope: 'user', status })
      .returning({ id: gdprExportRequest.id });
    return row?.id ?? '';
  }

  afterAll(async () => {
    const ids = users.map((u) => u.id);
    const orgIds = [orgId, otherOrgId];

    /**
     * The archives too, not just the rows. The worker runs in this process, so the
     * queued exports above really were written to the bucket — and deleting the rows
     * first would leave objects nothing points at any more, which is precisely the
     * rubbish the sweep exists to avoid.
     */
    const archives = await db
      .select({ objectKey: gdprExportRequest.objectKey })
      .from(gdprExportRequest)
      .where(inArray(gdprExportRequest.userId, ids));
    await app
      .get(S3Service)
      .deleteMany(archives.map((r) => r.objectKey).filter((key): key is string => !!key));

    await db.delete(gdprExportRequest).where(inArray(gdprExportRequest.userId, ids));
    await db.delete(deletionRequest).where(inArray(deletionRequest.subjectId, [...ids, ...orgIds]));
    await db.delete(subscription).where(inArray(subscription.referenceId, orgIds));
    await db.delete(emailMessage).where(inArray(emailMessage.userId, ids));
    await db.delete(session).where(inArray(session.userId, ids));
    await db.delete(member).where(inArray(member.organizationId, orgIds));
    await db.delete(organization).where(inArray(organization.id, orgIds));
    await db.delete(user).where(inArray(user.id, ids));
    await app.close();
  });

  describe('export', () => {
    let exportId: string;

    it('records a personal request and answers 202', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/gdpr/exports/me')
        .set(as(colleague))
        .send({})
        .expect(202);

      expect(res.body.data.scope).toBe('user');
      // 202 means "queued": there is nothing to download yet, and saying otherwise is
      // how a client ends up asking for a file that does not exist.
      expect(res.body.data.downloadable).toBe(false);
      exportId = res.body.data.id as string;
    });

    /**
     * Written against a row this test puts in `processing` rather than against the one
     * queued above: the worker runs in this process, so the queued export finishes on
     * its own schedule and an assertion about "still being prepared" would be a race
     * that passes on a fast machine.
     */
    it('refuses a second request while the first is still being prepared', async () => {
      await givenExport(outsider, 'processing');

      const res = await request(app.getHttpServer())
        .post('/api/gdpr/exports/me')
        .set(as(outsider))
        .send({})
        .expect(409);

      expect(res.body.messageCode).toBe('GDPR_EXPORT_IN_PROGRESS');
    });

    it('lists only the caller’s own requests', async () => {
      const mine = await request(app.getHttpServer())
        .get('/api/gdpr/exports')
        .set(as(colleague))
        .expect(200);
      expect(mine.body.data.map((r: { id: string }) => r.id)).toContain(exportId);

      const theirs = await request(app.getHttpServer())
        .get('/api/gdpr/exports')
        .set(as(owner))
        .expect(200);
      expect(theirs.body.data.map((r: { id: string }) => r.id)).not.toContain(exportId);
    });

    /**
     * The one that matters. Both a colleague in the same organization and a stranger
     * get 404 rather than 403: a 403 would confirm the id exists, and an id that is
     * known to exist is the first half of an attack on it.
     */
    it('hides another person’s export behind a 404, inside and outside the tenant', async () => {
      for (const other of [owner, outsider]) {
        const res = await request(app.getHttpServer())
          .get(`/api/gdpr/exports/${exportId}/download`)
          .set(as(other))
          .expect(404);
        expect(res.body.messageCode).toBe('NOT_FOUND');
      }
    });

    it('refuses to hand over an archive that does not exist yet', async () => {
      const pending = await givenExport(owner, 'pending');

      const res = await request(app.getHttpServer())
        .get(`/api/gdpr/exports/${pending}/download`)
        .set(as(owner))
        .expect(409);

      expect(res.body.messageCode).toBe('GDPR_EXPORT_NOT_READY');
    });

    /**
     * The whole pipeline, driven by hand rather than by the queue: build the archive,
     * then ask for it. Calling the service directly keeps the assertion deterministic —
     * a test that waited for a worker would hang wherever QUEUE_RUN_WORKERS is false.
     */
    it('builds the archive and then hands over a short-lived link', async () => {
      const pending = await givenExport(colleague, 'pending');
      await app.get(GdprExportService).run(pending);

      const res = await request(app.getHttpServer())
        .get(`/api/gdpr/exports/${pending}/download`)
        .set(as(colleague))
        .expect(200);

      // Presigned, straight at storage: the bytes never pass through this API.
      expect(res.body.data.url).toContain('X-Amz-Signature');
      expect(new Date(res.body.data.expiresAt as string).getTime()).toBeGreaterThan(Date.now());
    });

    it('needs gdpr.export to ask for the whole organization', async () => {
      const refused = await request(app.getHttpServer())
        .post('/api/gdpr/exports/organization')
        .set(as(colleague))
        .send({})
        .expect(403);
      expect(refused.body.messageCode).toBe('FORBIDDEN_MISSING_PERMISSION');

      const allowed = await request(app.getHttpServer())
        .post('/api/gdpr/exports/organization')
        .set(as(owner))
        .send({})
        .expect(202);
      expect(allowed.body.data.scope).toBe('organization');
    });
  });

  describe('erasure', () => {
    let deletionId: string;

    it('schedules an account erasure in the future, and says when', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/gdpr/deletion-requests/account')
        .set(as(colleague))
        .send({ reason: 'moving on' })
        .expect(202);

      expect(res.body.data.subjectType).toBe('user');
      expect(res.body.data.status).toBe('scheduled');
      // The grace period is the feature: an erasure that ran now would make the
      // cancel button below a lie.
      expect(new Date(res.body.data.scheduledFor as string).getTime()).toBeGreaterThan(Date.now());

      deletionId = res.body.data.id as string;
    });

    it('refuses a second one for the same subject', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/gdpr/deletion-requests/account')
        .set(as(colleague))
        .send({})
        .expect(409);

      expect(res.body.messageCode).toBe('GDPR_DELETION_ALREADY_SCHEDULED');
    });

    it('does not let anybody else call it off', async () => {
      await request(app.getHttpServer())
        .delete(`/api/gdpr/deletion-requests/${deletionId}`)
        .set(as(owner))
        .expect(404);

      const stillThere = await request(app.getHttpServer())
        .get('/api/gdpr/deletion-requests')
        .set(as(colleague))
        .expect(200);
      expect(stillThere.body.data).toHaveLength(1);
    });

    it('lets the person who asked call it off', async () => {
      await request(app.getHttpServer())
        .delete(`/api/gdpr/deletion-requests/${deletionId}`)
        .set(as(colleague))
        .expect(204);

      const gone = await request(app.getHttpServer())
        .get('/api/gdpr/deletion-requests')
        .set(as(colleague))
        .expect(200);
      expect(gone.body.data).toHaveLength(0);
    });

    /**
     * The organization would survive the account, with nobody able to administer it.
     * The answer is "hand it over first", not "leave a tenant locked": an owner who
     * erases themselves takes the only route back in with them.
     */
    it('refuses to erase the only owner of an organization that has other members', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/gdpr/deletion-requests/account')
        .set(as(owner))
        .send({})
        .expect(409);

      expect(res.body.messageCode).toBe('ORGANIZATION_LAST_OWNER');
      expect(res.body.details.organizationId).toBe(orgId);
    });

    it('needs org.delete to erase the organization', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/gdpr/deletion-requests/organization')
        .set(as(colleague))
        .send({})
        .expect(403);

      expect(res.body.messageCode).toBe('FORBIDDEN_MISSING_PERMISSION');
    });

    /**
     * Money stops it. Written against a `subscription` row rather than against Stripe:
     * the suite must never call Stripe (see setup.ts), and this decision is taken from
     * the database anyway — which is the point, because a worker in the middle of the
     * night has no browser to send anybody to the billing screen.
     */
    it('refuses while a live subscription still points at the organization', async () => {
      await db.insert(subscription).values({
        id: `sub-gdpr-${Date.now()}`,
        plan: 'pro',
        referenceId: orgId,
        status: 'active',
      });

      const refused = await request(app.getHttpServer())
        .post('/api/gdpr/deletion-requests/organization')
        .set(as(owner))
        .send({})
        .expect(409);
      expect(refused.body.messageCode).toBe('GDPR_DELETION_BLOCKED_BY_SUBSCRIPTION');

      await db.delete(subscription).where(eq(subscription.referenceId, orgId));

      const accepted = await request(app.getHttpServer())
        .post('/api/gdpr/deletion-requests/organization')
        .set(as(owner))
        .send({})
        .expect(202);
      expect(accepted.body.data.subjectType).toBe('organization');

      // Left cancelled rather than pending: the sweep in a development database would
      // otherwise come along and erase the tenant this spec built.
      await request(app.getHttpServer())
        .delete(`/api/gdpr/deletion-requests/${accepted.body.data.id}`)
        .set(as(owner))
        .expect(204);
    });
  });
});
