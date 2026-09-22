import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { appSetting, auditLog, emailMessage, member, session, user } from '@app/db';
import { DEFAULT_MAINTENANCE_MODE, MAINTENANCE_SETTING_KEY } from '@app/contracts';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * Maintenance mode, which is only worth having if two things hold at once: everybody
 * is really refused, and the person who switched it on can still switch it off.
 *
 * The second is the one that is easy to lose. A guard placed before authentication, or
 * without the exemption on its own endpoints, produces a product whose only remaining
 * administration interface is `psql`.
 */
describe('maintenance mode (e2e)', () => {
  let app: INestApplication;
  let superadmin: TestUser;
  let plain: TestUser;

  const users: TestUser[] = [];
  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  const setMode = (actor: TestUser, body: Record<string, unknown>) =>
    request(app.getHttpServer()).put('/api/maintenance').set(as(actor)).send(body);

  const open = { enabled: false, messageKey: null, until: null, allowRoles: ['superadmin'] };
  const closed = {
    enabled: true,
    messageKey: 'maintenance.upgrading',
    until: null,
    allowRoles: ['superadmin'],
  };

  beforeAll(async () => {
    app = await createTestApp();

    superadmin = await signUp(app, 'maint-super');
    plain = await signUp(app, 'maint-plain');
    users.push(superadmin, plain);

    await db.update(user).set({ role: 'superadmin' }).where(eq(user.id, superadmin.id));
  });

  afterAll(async () => {
    /**
     * Straight to the row, not through the API: if a test failed halfway the product
     * is currently offline, and every other spec file in this run would fail with 503
     * for a reason that has nothing to do with what it was testing.
     */
    await db
      .update(appSetting)
      .set({ value: DEFAULT_MAINTENANCE_MODE })
      .where(eq(appSetting.key, MAINTENANCE_SETTING_KEY));

    // Everything this spec created. The suite shares one database with development,
    // and a spec that leaves its accounts behind fills the administration screens
    // with `e2e-…@test.local`.
    const ids = users.map((u) => u.id);

    await db.delete(auditLog).where(inArray(auditLog.actorUserId, ids));
    await db.delete(emailMessage).where(
      inArray(
        emailMessage.toEmail,
        users.map((u) => u.email),
      ),
    );
    await db.delete(session).where(inArray(session.userId, ids));
    await db.delete(member).where(inArray(member.userId, ids));
    await db.delete(user).where(inArray(user.id, ids));
    await app.close();
  });

  afterEach(async () => {
    // Every test leaves the product open, whatever it did in the middle.
    await setMode(superadmin, open);
  });

  it('refuses the setting to an account without platform.maintenance.manage', async () => {
    await request(app.getHttpServer()).get('/api/maintenance').set(as(plain)).expect(403);
  });

  it('refuses an allow list nobody is on', async () => {
    // An empty list locks out whoever would turn it back off. The only way back in
    // would be an UPDATE against production, so the contract refuses it.
    await setMode(superadmin, { ...closed, allowRoles: [] }).expect(422);
  });

  it('answers 503 to everybody else, carrying the notice as a key', async () => {
    await setMode(superadmin, closed).expect(200);

    await request(app.getHttpServer())
      .get('/api/me')
      .set(as(plain))
      .expect(503)
      .expect((res) => {
        expect(res.body.messageCode).toBe('MAINTENANCE_MODE');
        // A key, not a sentence: the client translates it like any other error.
        expect(res.body.details).toMatchObject({ messageKey: 'maintenance.upgrading' });
      });
  });

  it('lets the allowed role through, and tells it the shop is closed', async () => {
    await setMode(superadmin, closed).expect(200);

    const res = await request(app.getHttpServer()).get('/api/me').set(as(superadmin)).expect(200);
    expect(res.body.data.maintenance).toMatchObject({ enabled: true });
  });

  it('keeps the health probes answering', async () => {
    await setMode(superadmin, closed).expect(200);

    // An orchestrator reads 503 as "restart this container". A planned pause must not
    // become a restart loop.
    await request(app.getHttpServer()).get('/health/live').expect(200);
    await request(app.getHttpServer()).get('/health/ready').expect(200);
  });

  it('keeps the way out reachable from inside', async () => {
    await setMode(superadmin, closed).expect(200);

    await request(app.getHttpServer()).get('/api/maintenance').set(as(superadmin)).expect(200);
    await setMode(superadmin, open).expect(200);

    await request(app.getHttpServer()).get('/api/me').set(as(plain)).expect(200);
  });

  it('keeps signing in possible, or nobody could come back to switch it off', async () => {
    await setMode(superadmin, closed).expect(200);

    // Better Auth's routes are mounted as middleware and cannot be decorated, so the
    // guard exempts them by path. A session is all this grants: every other endpoint
    // still answers 503 to a role that is not on the list.
    const fresh = await signUp(app, 'maint-late');
    users.push(fresh);

    await request(app.getHttpServer()).get('/api/me').set(as(fresh)).expect(503);
  });

  it('reports no maintenance at all once it is over', async () => {
    const res = await request(app.getHttpServer()).get('/api/me').set(as(plain)).expect(200);
    expect(res.body.data.maintenance).toBeNull();
  });
});
