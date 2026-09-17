/**
 * Creates the Stripe catalogue from the `plan` table and writes the price ids back.
 *
 * One Product per plan, as Stripe recommends: Checkout and invoices show the Product
 * name on each line item, so putting several tiers on one Product makes every line read
 * the same and customers cannot tell what they bought. Prices are the billing variants
 * of a plan — monthly and yearly — which is what a Product is allowed to have several of.
 *
 * Idempotent: a plan that already carries a Stripe product id is skipped, so running it
 * twice does not create duplicates.
 *
 *   pnpm stripe:setup
 */
import { resolve } from 'node:path';
import { exit, env } from 'node:process';
import { config as loadEnv } from 'dotenv';
import Stripe from 'stripe';
import { createDatabase, plan as planTable } from '@app/db';
import { eq } from 'drizzle-orm';

loadEnv({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

const secretKey = env.STRIPE_SECRET_KEY;
const databaseUrl = env.DATABASE_URL;

if (!secretKey) {
  console.error(
    'STRIPE_SECRET_KEY is missing. Run `stripe sandbox create` and put the key in .env.',
  );
  exit(1);
}
if (!databaseUrl) {
  console.error('DATABASE_URL is missing.');
  exit(1);
}

const stripe = new Stripe(secretKey);
const { db, pool } = createDatabase({ url: databaseUrl });

try {
  const plans = await db.select().from(planTable);
  let created = 0;

  for (const row of plans) {
    // The free plan is the absence of a subscription: no product, no price.
    if (row.amountMonthly === 0) {
      console.warn(`· ${row.key}: free plan, nothing to create`);
      continue;
    }
    if (row.stripeProductId) {
      console.warn(`· ${row.key}: already linked to ${row.stripeProductId}`);
      continue;
    }

    const product = await stripe.products.create({
      name: row.key.charAt(0).toUpperCase() + row.key.slice(1),
      metadata: { planKey: row.key },
    });

    const monthly = await stripe.prices.create({
      product: product.id,
      currency: row.currency.toLowerCase(),
      unit_amount: row.amountMonthly,
      recurring: { interval: 'month' },
      // Tax is calculated from the product's tax code once registrations exist; the
      // price has to declare whether its amount already includes tax.
      tax_behavior: 'exclusive',
    });

    const yearly = row.amountYearly
      ? await stripe.prices.create({
          product: product.id,
          currency: row.currency.toLowerCase(),
          unit_amount: row.amountYearly,
          recurring: { interval: 'year' },
          tax_behavior: 'exclusive',
        })
      : null;

    await db
      .update(planTable)
      .set({
        stripeProductId: product.id,
        stripePriceIdMonthly: monthly.id,
        stripePriceIdYearly: yearly?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(planTable.id, row.id));

    created += 1;
    console.warn(`✓ ${row.key}: ${product.id} (${monthly.id}${yearly ? `, ${yearly.id}` : ''})`);
  }

  console.warn(`\n${created} plan(s) created in Stripe.`);
  console.warn('Remember: tax is only collected where an active registration exists.');
} finally {
  await pool.end();
}
