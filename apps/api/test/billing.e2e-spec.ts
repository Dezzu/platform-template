import type { INestApplication } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { member, organization, stripeEvent, user } from '@app/db';
import { db } from '../src/database/db';
import { canActOnSubscription, recordStripeEvent } from '../src/modules/billing/stripe-plugin';
import { createTestApp } from './app.factory';
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

    it('honours BILLING_SCOPE=user: the reference is the person, not the tenant', async () => {
      const previous = process.env['BILLING_SCOPE'];
      process.env['BILLING_SCOPE'] = 'user';

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
        if (previous === undefined) delete process.env['BILLING_SCOPE'];
        else process.env['BILLING_SCOPE'] = previous;
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
