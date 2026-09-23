import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { inArray } from 'drizzle-orm';
import { member, notification, notificationPreference, organization, session, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { createOrganization, ORIGIN, signUp, type TestUser } from './helpers/auth';

/**
 * Notifications, and the two things about them that are expensive to get wrong.
 *
 * A notification is addressed to one person inside one tenant, so the query is scoped
 * twice — by organization and by recipient. Getting either wrong means one member
 * reading another's mail, which no screen would reveal.
 *
 * And a channel the registry marks mandatory has to be refused rather than quietly
 * ignored: a switch that accepts the click and changes nothing is worse than one that
 * says no.
 */
describe('notifications (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser;
  let colleague: TestUser;
  let outsider: TestUser;
  let orgId: string;
  let otherOrgId: string;

  const users: TestUser[] = [];
  const as = (u: TestUser) => ({ Cookie: u.cookie, Origin: ORIGIN });

  async function give(
    to: TestUser,
    organizationId: string,
    type = 'member.joined',
  ): Promise<string> {
    const [row] = await db
      .insert(notification)
      .values({
        organizationId,
        userId: to.id,
        type,
        titleKey: `notifications.types.${type}.title`,
        bodyKey: `notifications.types.${type}.body`,
        params: { memberName: 'Tester' },
      })
      .returning({ id: notification.id });
    return row?.id ?? '';
  }

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'notif-owner');
    colleague = await signUp(app, 'notif-colleague');
    outsider = await signUp(app, 'notif-outsider');
    users.push(owner, colleague, outsider);

    orgId = await createOrganization(app, owner, 'NotifOrg');
    otherOrgId = await createOrganization(app, outsider, 'NotifOther');

    await db.insert(member).values({
      id: `m-notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: orgId,
      userId: colleague.id,
      role: 'member',
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    const ids = users.map((u) => u.id);
    await db.delete(notification).where(inArray(notification.userId, ids));
    await db.delete(notificationPreference).where(inArray(notificationPreference.userId, ids));
    await db.delete(session).where(inArray(session.userId, ids));
    await db.delete(member).where(inArray(member.organizationId, [orgId, otherOrgId]));
    await db.delete(organization).where(inArray(organization.id, [orgId, otherOrgId]));
    await db.delete(user).where(inArray(user.id, ids));
    await app.close();
  });

  describe('who can read what', () => {
    it('shows you your own, and not your colleague’s', async () => {
      const mine = await give(owner, orgId);
      await give(colleague, orgId);

      const res = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(as(owner))
        .expect(200);

      const ids = (res.body.data.items as { id: string }[]).map((n) => n.id);
      expect(ids).toContain(mine);
      expect(res.body.data.meta.total).toBe(1);
    });

    it('filters to the unread ones when asked, which is what the bell panel shows', async () => {
      const read = await give(owner, orgId);
      await request(app.getHttpServer())
        .post(`/api/notifications/${read}/read`)
        .set(as(owner))
        .expect(200);

      const all = await request(app.getHttpServer())
        .get('/api/notifications')
        .set(as(owner))
        .expect(200);
      expect(all.body.data.meta.total).toBe(2);

      /**
       * `unread` arrives as the string "true" in a query string and is coerced by the
       * contract. If that coercion ever stops working the endpoint does not fail — it
       * quietly returns everything, and the panel silently becomes a list of things
       * already dealt with. Which is precisely how it behaved.
       */
      const unread = await request(app.getHttpServer())
        .get('/api/notifications?unread=true')
        .set(as(owner))
        .expect(200);

      expect(unread.body.data.meta.total).toBe(1);
      expect((unread.body.data.items as { id: string }[])[0]?.id).not.toBe(read);
    });

    it('does not cross the tenant boundary', async () => {
      // Measured as a difference rather than against a fixed number: these cases run
      // in order and share a database, and a test that hard-codes a total breaks the
      // moment somebody adds a case above it. One did.
      const countMine = async () =>
        (await request(app.getHttpServer()).get('/api/notifications').set(as(owner)).expect(200))
          .body.data.meta.total as number;

      const before = await countMine();

      // The same account, a notification in an organization it does not belong to.
      await db.insert(notification).values({
        organizationId: otherOrgId,
        userId: owner.id,
        type: 'member.joined',
        titleKey: 'x',
        bodyKey: 'y',
      });

      // Unchanged: the row in the other organization is invisible from inside this one.
      expect(await countMine()).toBe(before);
    });

    /**
     * The other half of the same boundary, added when exports started raising these.
     *
     * A notification with no organization is a fact about the person — "la copia dei
     * tuoi dati è pronta" — so it has to be readable from whichever tenant they happen
     * to be working in. What must NOT relax with it is the recipient: the widened
     * tenant predicate would be a leak if `user_id` were ever dropped alongside it, so
     * both directions are asserted here rather than only the convenient one.
     */
    it('shows a notification that belongs to no tenant from inside any of them', async () => {
      const countFor = async (who: TestUser) =>
        (await request(app.getHttpServer()).get('/api/notifications').set(as(who)).expect(200)).body
          .data.meta.total as number;

      const mineBefore = await countFor(owner);
      const theirsBefore = await countFor(colleague);

      await db.insert(notification).values({
        organizationId: null,
        userId: owner.id,
        type: 'gdpr.export_ready',
        titleKey: 'notifications.types.gdpr.export_ready.title',
        bodyKey: 'notifications.types.gdpr.export_ready.body',
      });

      expect(await countFor(owner)).toBe(mineBefore + 1);
      // And not to a colleague in the same organization: no tenant does not mean
      // everybody's.
      expect(await countFor(colleague)).toBe(theirsBefore);
    });

    it('refuses to mark somebody else’s as read, as a 404 rather than a 403', async () => {
      const theirs = await give(colleague, orgId);

      // 404 and not 403 on purpose: answering "forbidden" would confirm the id exists.
      await request(app.getHttpServer())
        .post(`/api/notifications/${theirs}/read`)
        .set(as(owner))
        .expect(404);
    });

    it('counts and clears only what is yours', async () => {
      const before = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set(as(owner))
        .expect(200);
      // Not a fixed number, for the reason the case above already gives: these run in
      // order against a shared database, and a hard-coded total breaks the moment
      // somebody adds a case before it. Somebody did, twice.
      expect(before.body.data.unread).toBeGreaterThan(0);

      await request(app.getHttpServer())
        .post('/api/notifications/read-all')
        .set(as(owner))
        .expect(200)
        .expect((res) => expect(res.body.data.unread).toBe(0));

      // The colleague's are untouched: "all" means all of mine.
      const theirs = await request(app.getHttpServer())
        .get('/api/notifications/unread-count')
        .set(as(colleague))
        .expect(200);
      expect(theirs.body.data.unread).toBeGreaterThan(0);
    });
  });

  describe('preferences', () => {
    it('answers the whole matrix, defaults applied, before anything is chosen', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/notifications/preferences')
        .set(as(owner))
        .expect(200);

      const rows = res.body.data as {
        type: string;
        channel: string;
        enabled: boolean;
        editable: boolean;
      }[];

      // A missing row means "never decided", not "off" — so the screen has to be able
      // to render every switch before the user has touched any of them.
      const joinedEmail = rows.find((r) => r.type === 'member.joined' && r.channel === 'email');
      expect(joinedEmail).toMatchObject({ enabled: false, editable: true });

      const billingEmail = rows.find(
        (r) => r.type === 'billing.payment_failed' && r.channel === 'email',
      );
      expect(billingEmail).toMatchObject({ enabled: true, editable: false });

      /**
       * The export announcement: in-app is a preference, email is not.
       *
       * An archive expires. Somebody who muted the email months ago and does not open
       * the notification centre would learn their export was ready only after it had
       * been swept — which is a request quietly ignored rather than served.
       */
      const exportEmail = rows.find((r) => r.type === 'gdpr.export_ready' && r.channel === 'email');
      expect(exportEmail).toMatchObject({ enabled: true, editable: false });

      const exportInApp = rows.find(
        (r) => r.type === 'gdpr.export_ready' && r.channel === 'in_app',
      );
      expect(exportInApp).toMatchObject({ enabled: true, editable: true });
    });

    it('stores an explicit choice and reports it back', async () => {
      await request(app.getHttpServer())
        .put('/api/notifications/preferences')
        .set(as(owner))
        .send({ type: 'member.joined', channel: 'email', enabled: true })
        .expect(200)
        .expect((res) => {
          const row = (res.body.data as { type: string; channel: string; enabled: boolean }[]).find(
            (r) => r.type === 'member.joined' && r.channel === 'email',
          );
          expect(row?.enabled).toBe(true);
        });
    });

    it('refuses to switch off a mandatory channel', async () => {
      // Not silently ignored: a renewal that failed takes the product away in days,
      // and the one person who would mute it is the one who most needs it.
      await request(app.getHttpServer())
        .put('/api/notifications/preferences')
        .set(as(owner))
        .send({ type: 'billing.payment_failed', channel: 'email', enabled: false })
        .expect(403);

      // Same for the export announcement, and for the same kind of reason.
      await request(app.getHttpServer())
        .put('/api/notifications/preferences')
        .set(as(owner))
        .send({ type: 'gdpr.export_ready', channel: 'email', enabled: false })
        .expect(403);
    });

    it('is a statement about a person, not about a tenant', async () => {
      // No organization header, no active organization needed: preferences are
      // user-scoped, which is why the route is @OrgOptional().
      await request(app.getHttpServer())
        .get('/api/notifications/preferences')
        .set(as(outsider))
        .expect(200);
    });
  });
});
