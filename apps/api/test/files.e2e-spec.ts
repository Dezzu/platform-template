import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { auditLog, file, member, organization, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * The upload round trip, against the real MinIO from docker/compose.dev.yml.
 *
 * Mocking storage here would prove nothing: every interesting failure of this feature
 * is a disagreement between what we sign and what the object store accepts — a header
 * in the signature the client does not send, a checksum the SDK added on its own, a
 * region baked into the signature. A fake S3 agrees with whatever we send it.
 */
describe('files: presigned upload round trip (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser;
  let outsider: TestUser;
  let orgA: string;
  let orgB: string;

  const users: TestUser[] = [];
  const CONTENT = 'phase 8: the bytes never pass through Node.\n';

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'files-owner');
    outsider = await signUp(app, 'files-outsider');
    users.push(owner, outsider);

    orgA = await createOrganization(app, owner, 'FilesA');
    orgB = await createOrganization(app, outsider, 'FilesB');
  });

  afterAll(async () => {
    await db.delete(auditLog).where(inArray(auditLog.organizationId, [orgA, orgB]));
    await db.delete(file).where(inArray(file.organizationId, [orgA, orgB]));
    await db.delete(member).where(inArray(member.organizationId, [orgA, orgB]));
    await db.delete(organization).where(inArray(organization.id, [orgA, orgB]));
    await db.delete(user).where(
      inArray(
        user.id,
        users.map((u) => u.id),
      ),
    );
    await app.close();
  });

  it('issues a ticket, accepts the PUT, commits, and serves the bytes back', async () => {
    const ticket = await request(app.getHttpServer())
      .post('/api/files/upload-url')
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .send({ fileName: 'note.txt', contentType: 'text/plain', size: CONTENT.length })
      .expect(201);

    const { file: created, uploadUrl, requiredHeaders } = ticket.body.data;
    expect(created.status).toBe('pending');
    // The key is tenant-prefixed, which is what makes a bucket listing per customer
    // possible and a per-prefix policy expressible later.
    expect(created.objectKey.startsWith(`${orgA}/`)).toBe(true);

    // Straight to storage: this request does not touch the API at all.
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: requiredHeaders,
      body: CONTENT,
    });
    expect(put.status).toBe(200);

    const committed = await request(app.getHttpServer())
      .post(`/api/files/${created.id}/commit`)
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(200);

    expect(committed.body.data.status).toBe('ready');
    // The size recorded is the one storage reports, not the one the client declared.
    expect(committed.body.data.size).toBe(CONTENT.length);

    const download = await request(app.getHttpServer())
      .get(`/api/files/${created.id}/download-url`)
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(200);

    const fetched = await fetch(download.body.data.downloadUrl);
    expect(fetched.status).toBe(200);
    expect(await fetched.text()).toBe(CONTENT);
    // The download is named after what the user called it, not after the UUID key.
    expect(fetched.headers.get('content-disposition')).toContain('note.txt');

    // Deleting removes the object, so the presigned URL — still unexpired — stops working.
    await request(app.getHttpServer())
      .delete(`/api/files/${created.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(204);

    expect((await fetch(download.body.data.downloadUrl)).status).toBe(404);

    const [row] = await db.select().from(file).where(eq(file.id, created.id));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('refuses to commit when the PUT never happened', async () => {
    const ticket = await request(app.getHttpServer())
      .post('/api/files/upload-url')
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .send({ fileName: 'ghost.txt', contentType: 'text/plain', size: 10 })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/files/${ticket.body.data.file.id}/commit`)
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(409);

    expect(res.body.messageCode).toBe('FILE_NOT_UPLOADED');
  });

  it('refuses an oversized upload before issuing a URL', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/files/upload-url')
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .send({ fileName: 'huge.bin', contentType: 'application/octet-stream', size: 5_000_000_000 })
      .expect(413);

    expect(res.body.messageCode).toBe('FILE_TOO_LARGE');
  });

  it('does not let another organization see, commit, download or delete the file', async () => {
    const ticket = await request(app.getHttpServer())
      .post('/api/files/upload-url')
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .send({ fileName: 'private.txt', contentType: 'text/plain', size: CONTENT.length })
      .expect(201);

    const { file: created, uploadUrl, requiredHeaders } = ticket.body.data;
    await fetch(uploadUrl, { method: 'PUT', headers: requiredHeaders, body: CONTENT });
    await request(app.getHttpServer())
      .post(`/api/files/${created.id}/commit`)
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(200);

    // 404, not 403: a 403 would confirm to org B that this id exists.
    await request(app.getHttpServer())
      .get(`/api/files/${created.id}/download-url`)
      .set('Cookie', outsider.cookie)
      .set('Origin', ORIGIN)
      .expect(404);

    await request(app.getHttpServer())
      .post(`/api/files/${created.id}/commit`)
      .set('Cookie', outsider.cookie)
      .set('Origin', ORIGIN)
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/files/${created.id}`)
      .set('Cookie', outsider.cookie)
      .set('Origin', ORIGIN)
      .expect(404);

    const listed = await request(app.getHttpServer())
      .get('/api/files')
      .set('Cookie', outsider.cookie)
      .set('Origin', ORIGIN)
      .expect(200);

    expect(listed.body.data.items).toHaveLength(0);
    expect(listed.body.data.meta.total).toBe(0);

    // And org A still sees exactly its own.
    const own = await request(app.getHttpServer())
      .get('/api/files')
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(200);

    expect(own.body.data.items.map((f: { id: string }) => f.id)).toContain(created.id);
    expect(
      own.body.data.items.every((f: { organizationId: string }) => f.organizationId === orgA),
    ).toBe(true);

    // Through the endpoint, so the object goes too: deleting only the rows in afterAll
    // would leave an orphan in the bucket on every run.
    await request(app.getHttpServer())
      .delete(`/api/files/${created.id}`)
      .set('Cookie', owner.cookie)
      .set('Origin', ORIGIN)
      .expect(204);
  });
});
