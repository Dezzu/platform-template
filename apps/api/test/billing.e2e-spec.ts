import https from 'node:https';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { eq, inArray } from 'drizzle-orm';
import { member, organization, stripeEvent, subscription, user } from '@app/db';
import { db } from '../src/database/db';
import { canActOnSubscription, recordStripeEvent } from '../src/modules/billing/stripe-plugin';
import { createTestApp } from './app.factory';
import { stripeCallAttempts, targetsStripe } from './setup';
import { createOrganization, signUp, type TestUser } from './helpers/auth';

/**
 * The two pieces of the billing integration whose failure modes are expensive, both
 * provable without a Stripe account.
 */
describe('billing (e2e)', () => {
  let app: INestApplication;
  let owner: TestUser;
  let plain: TestUser;
  let outsider: TestUser;
  let orgId: string;
  const eventIds: string[] = [];

  beforeAll(async () => {
    app = await createTestApp();

    owner = await signUp(app, 'billing-owner');
    plain = await signUp(app, 'billing-member');
    outsider = await signUp(app, 'billing-outsider');

    orgId = await createOrganization(app, owner, 'BillingOrg');
    await db.insert(member).values({
      id: `m-billing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      organizationId: orgId,
      userId: plain.id,
      role: 'member',
      createdAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(subscription).where(eq(subscription.referenceId, orgId));
    if (eventIds.length) await db.delete(stripeEvent).where(inArray(stripeEvent.id, eventIds));
    await db.delete(organization).where(eq(organization.id, orgId));
    await db.delete(user).where(inArray(user.id, [owner.id, plain.id, outsider.id]));
    await app.close();
  });

  describe('webhook idempotency', () => {
    it('accepts an event once and refuses the replay', async () => {
      const id = `evt_test_${Date.now()}`;
      eventIds.push(id);
      const event = { id, type: 'customer.subscription.updated', api_version: '2026-08-26' };

      expect(await recordStripeEvent(event)).toBe(true);
      // Stripe retries for up to 72 hours and can deliver the same event more than
      // once even when nothing failed. A replay must not repeat the side effect.
      expect(await recordStripeEvent(event)).toBe(false);
    });

    it('lets exactly one of several concurrent deliveries through', async () => {
      const id = `evt_race_${Date.now()}`;
      eventIds.push(id);
      const event = { id, type: 'invoice.paid', api_version: '2026-08-26' };

      const results = await Promise.all([
        recordStripeEvent(event),
        recordStripeEvent(event),
        recordStripeEvent(event),
      ]);

      // The primary key is the boundary, so the database arbitrates rather than a
      // read-then-write check that two workers could both pass.
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('keeps the payload, so a failed handler can be replayed deliberately', async () => {
      const id = `evt_payload_${Date.now()}`;
      eventIds.push(id);
      await recordStripeEvent({ id, type: 'invoice.payment_failed', api_version: '2026-08-26' });

      const [row] = await db.select().from(stripeEvent).where(eq(stripeEvent.id, id));
      expect(row?.type).toBe('invoice.payment_failed');
      expect(row?.payload).toMatchObject({ id });
    });
  });

  /**
   * The paywall, over HTTP.
   *
   * Hiding a menu entry is a courtesy to the reader; this is the part that actually
   * refuses. The subscription row is inserted directly rather than driven through
   * Stripe: what is under test is the gate, not the checkout.
   */
  describe('paid features', () => {
    it('refuses with 402 when the reference has no subscription', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/insights')
        .set('Cookie', owner.cookie)
        .expect(402);

      // 402 and not 403: the caller is allowed to do this, they simply have not paid,
      // and a client that cannot tell the two apart shows the wrong message.
      expect(res.body.messageCode).toBe('SUBSCRIPTION_REQUIRED');
    });

    it('serves the feature once an entitling subscription exists', async () => {
      await db.insert(subscription).values({
        id: `sub-test-${Date.now()}`,
        plan: 'pro',
        referenceId: orgId,
        status: 'active',
      });

      const res = await request(app.getHttpServer())
        .get('/api/insights')
        .set('Cookie', owner.cookie)
        .expect(200);

      expect(res.body.data.plan).toBe('pro');
      expect(res.body.data).toHaveProperty('totalProjects');
    });

    it('treats past_due as not entitling: the card has stopped working', async () => {
      await db
        .update(subscription)
        .set({ status: 'past_due' })
        .where(eq(subscription.referenceId, orgId));

      await request(app.getHttpServer())
        .get('/api/insights')
        .set('Cookie', owner.cookie)
        .expect(402);

      await db
        .update(subscription)
        .set({ status: 'active' })
        .where(eq(subscription.referenceId, orgId));
    });

    it('lets a member of a subscribed organization in: the tenant pays, not the person', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/insights')
        .set('Cookie', plain.cookie)
        .expect(200);

      expect(res.body.data).toHaveProperty('totalProjects');
    });

    it('does not leak it to another organization', async () => {
      // The outsider has no organization at all, so there is nothing to entitle them.
      await request(app.getHttpServer())
        .get('/api/insights')
        .set('Cookie', outsider.cookie)
        .expect((res) => {
          expect([400, 402, 404]).toContain(res.status);
        });
    });
  });

  /**
   * The suite must not spend Stripe's request budget. It used to: the sign-up hook
   * called `customers.search` and `customers.create` for every account created here,
   * dozens per run, and exhausting a claimable sandbox makes EVERY later Stripe call
   * answer 429 — including the customer portal in the browser, which then fails for a
   * reason that has nothing to do with this code.
   */
  describe('Stripe is never called from a test', () => {
    it('does not even try, for the three accounts this spec signed up', async () => {
      /**
       * The attempts list, not the absence of a customer id: with the network blocked
       * the id would be null either way, so asserting on it would pass whether or not
       * `createCustomerOnSignUp` had been switched back on. This fails the moment
       * something tries.
       */
      expect(stripeCallAttempts).toEqual([]);

      const [row] = await db
        .select({ stripeCustomerId: user.stripeCustomerId })
        .from(user)
        .where(eq(user.id, owner.id));

      expect(row?.stripeCustomerId ?? null).toBeNull();
    });

    // Runs after the assertion above on purpose: these calls are themselves recorded.
    it('refuses an outbound request, so a new hook cannot quietly start one', () => {
      // Enforced in test/setup.ts, because a flag that can be flipped back is a
      // promise and this is a guarantee.
      expect(() => https.request('https://api.stripe.com/v1/customers')).toThrow(/must not/);
      expect(() => void fetch('https://api.stripe.com/v1/customers')).toThrow(/must not/);
    });

    it('matches Stripe and nothing else', () => {
      /**
       * Asserted on the predicate rather than by opening a socket: a blanket ban would
       * take MinIO and Mailpit with it, and "check by connecting somewhere" is both a
       * real network call from a test — the thing this whole block exists to stop —
       * and a source of unhandled ECONNRESETs. It was, briefly.
       */
      expect(targetsStripe('https://api.stripe.com/v1/customers')).toBe(true);
      expect(targetsStripe({ hostname: 'api.stripe.com', path: '/v1/charges' })).toBe(true);
      expect(targetsStripe(new URL('https://files.stripe.com/x'))).toBe(true);

      expect(targetsStripe('http://localhost:9000/bucket')).toBe(false);
      expect(targetsStripe({ hostname: 'localhost', port: 1025 })).toBe(false);
      // Not a suffix match on the string: a lookalike host must not be trusted either.
      expect(targetsStripe('https://notstripe.com/')).toBe(false);
      expect(targetsStripe('https://api.stripe.com.evil.test/')).toBe(false);
    });
  });

  describe('who may act on a subscription', () => {
    it('lets the owner manage it', async () => {
      expect(await canActOnSubscription(owner.id, orgId, 'upgrade-subscription')).toBe(true);
      expect(await canActOnSubscription(owner.id, orgId, 'billing-portal')).toBe(true);
    });

    it('lets a member read it but not change what the organization pays', async () => {
      expect(await canActOnSubscription(plain.id, orgId, 'list-subscription')).toBe(true);
      expect(await canActOnSubscription(plain.id, orgId, 'upgrade-subscription')).toBe(false);
      expect(await canActOnSubscription(plain.id, orgId, 'cancel-subscription')).toBe(false);
    });

    it('honours APP_MODE=b2c: the reference is the person, not the tenant', async () => {
      const previous = process.env['APP_MODE'];
      process.env['APP_MODE'] = 'b2c';

      try {
        // In a B2C portal the subscription hangs off the person who pays.
        expect(await canActOnSubscription(owner.id, owner.id, 'upgrade-subscription')).toBe(true);
        expect(await canActOnSubscription(plain.id, plain.id, 'upgrade-subscription')).toBe(true);

        // And an organization reference is refused outright rather than silently
        // accepted, so a stale client cannot create subscriptions nothing will read.
        expect(await canActOnSubscription(owner.id, orgId, 'upgrade-subscription')).toBe(false);

        // Nobody manages anybody else's.
        expect(await canActOnSubscription(plain.id, owner.id, 'list-subscription')).toBe(false);
      } finally {
        if (previous === undefined) delete process.env['APP_MODE'];
        else process.env['APP_MODE'] = previous;
      }
    });

    it('refuses someone outside the organization entirely', async () => {
      // Without authorizeReference, Better Auth would only allow operations where the
      // referenceId equals the caller's own id — so this is the check that stops one
      // tenant reaching another's billing.
      for (const action of ['list-subscription', 'upgrade-subscription', 'billing-portal']) {
        expect(await canActOnSubscription(outsider.id, orgId, action)).toBe(false);
      }
    });
  });
});
