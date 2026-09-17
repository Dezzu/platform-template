/**
 * Fast-forwards a subscription through time, to see what the application does when a
 * plan actually ends.
 *
 * Cancelling a subscription immediately produces the same `customer.subscription.deleted`
 * event and is enough to check that access is revoked. What it cannot show is renewal:
 * the invoice at the end of the period, a payment that fails on renewal, a trial that
 * expires. Those only happen when time moves, and this is how Stripe lets it.
 *
 * The constraint that shapes this script: a customer must be created ON a test clock.
 * An existing customer cannot be attached to one, so the subscription created through
 * the normal checkout flow can never be fast-forwarded — a fresh one has to be built
 * here, wired to the same organization.
 *
 *   pnpm stripe:test-clock <organizationId> [planKey] [daysToAdvance]
 *
 * Requires `stripe listen` to be running, or the events go nowhere.
 *
 * Also requires a FULL test key. The `rkcs_test_...` key that `stripe sandbox create`
 * hands out is a restricted claimable-sandbox key: it can create checkouts and
 * subscriptions, but Stripe refuses test helpers with
 * "This is a claimable sandbox key with limited permissions". After claiming the
 * sandbox, take an `sk_test_...` key from Dashboard → Developers → API keys with that
 * sandbox selected, or run `stripe login`.
 */
import { resolve } from 'node:path';
import { argv, env, exit } from 'node:process';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { createDatabase, organization as orgTable, plan as planTable, subscription } from '@app/db';

loadEnv({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const [organizationId, planKey = 'pro', days = '35'] = argv.slice(2);

if (!organizationId) {
  console.error('usage: pnpm stripe:test-clock <organizationId> [planKey] [daysToAdvance]');
  exit(1);
}

if (env.STRIPE_SECRET_KEY?.startsWith('rkcs_')) {
  console.error(
    'STRIPE_SECRET_KEY is a restricted claimable-sandbox key (rkcs_), which cannot use\n' +
      'test clocks. Claim the sandbox, then use an sk_test_ key from the dashboard.',
  );
  exit(1);
}

const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const { db, pool } = createDatabase({ url: env.DATABASE_URL });

try {
  const [plan] = await db.select().from(planTable).where(eq(planTable.key, planKey));
  if (!plan?.stripePriceIdMonthly) {
    console.error(`Plan "${planKey}" has no Stripe price. Run pnpm stripe:setup first.`);
    exit(1);
  }

  const [org] = await db.select().from(orgTable).where(eq(orgTable.id, organizationId));
  if (!org) {
    console.error(`No organization ${organizationId}.`);
    exit(1);
  }

  const now = Math.floor(Date.now() / 1000);

  const clock = await stripe.testHelpers.testClocks.create({
    frozen_time: now,
    name: `${org.name} · ${planKey}`,
  });
  console.warn(`clock  ${clock.id} frozen at ${new Date(now * 1000).toISOString()}`);

  const customer = await stripe.customers.create({
    name: org.name,
    test_clock: clock.id,
    metadata: { organizationId },
  });
  console.warn(`customer ${customer.id} (on the clock)`);

  await stripe.paymentMethods.attach('pm_card_visa', { customer: customer.id });
  await stripe.customers.update(customer.id, {
    invoice_settings: { default_payment_method: 'pm_card_visa' },
  });

  // Better Auth maps an incoming Stripe subscription back to its own row through the
  // metadata it puts on checkout, so the row has to exist first and be named here.
  const rowId = randomUUID();
  await db.insert(subscription).values({
    id: rowId,
    plan: planKey,
    referenceId: organizationId,
    stripeCustomerId: customer.id,
    status: 'incomplete',
  });

  const created = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: plan.stripePriceIdMonthly }],
    metadata: { referenceId: organizationId, subscriptionId: rowId },
  });
  console.warn(`subscription ${created.id} status=${created.status}`);

  const target = now + Number(days) * 24 * 60 * 60;
  console.warn(`\nadvancing ${days} days — watch the stripe listen terminal...`);
  await stripe.testHelpers.testClocks.advance(clock.id, { frozen_time: target });

  console.warn(
    `\nThe clock is advancing in the background; Stripe emits the renewal events as it\n` +
      `goes. Watch them arrive, then check /api/insights and the billing page.\n\n` +
      `Clean up when done:\n  stripe test_helpers test_clocks delete ${clock.id}`,
  );
} finally {
  await pool.end();
}
