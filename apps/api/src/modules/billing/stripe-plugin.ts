import { and, eq } from 'drizzle-orm';
import Stripe from 'stripe';
import { stripe as stripePlugin } from '@better-auth/stripe';
import { member, plan as planTable, stripeEvent } from '@app/db';
import { billsThePerson, PERMISSIONS, permissionsForRole, type OrgRole } from '@app/contracts';
import { Logger } from '@nestjs/common';
import { appMode } from '../../config/app-mode';
import { db } from '../../database/db';

/**
 * Builds the Better Auth Stripe plugin, or returns null when Stripe is not configured.
 *
 * Returning null rather than constructing a client with an empty key keeps local
 * development usable without a Stripe account: everything except billing works, and
 * the production config validation refuses to start without the keys.
 */
const logger = new Logger('StripeWebhook');

type StripePluginOptions = Parameters<typeof stripePlugin>[0];

/**
 * The Stripe SDK publishes separate CJS and ESM type declarations. This package
 * resolves to the CJS ones while @better-auth/stripe, being ESM, expects the ESM ones,
 * and under `exactOptionalPropertyTypes` the two are structurally incompatible — even
 * though they describe the same class and the same runtime object.
 *
 * The cast is derived from the plugin's own signature rather than written by hand, so
 * it cannot drift into asserting something the plugin does not actually want.
 */
type PluginStripeClient = StripePluginOptions['stripeClient'];

/**
 * Records a Stripe event, returning false when it has already been seen.
 *
 * The primary key IS the Stripe event id, so this is the idempotency boundary itself
 * rather than a check in front of one: two concurrent deliveries race on the insert and
 * exactly one wins. Stripe retries a failing webhook for up to 72 hours and can deliver
 * the same event more than once even when nothing failed, so "already handled" has to
 * be a database fact.
 *
 * Exported for tests: this is the piece whose failure mode is a double charge or a
 * duplicated side effect, and it must be provable without a Stripe account.
 */
export async function recordStripeEvent(event: {
  id: string;
  type: string;
  api_version?: string | null;
}): Promise<boolean> {
  const [inserted] = await db
    .insert(stripeEvent)
    .values({
      id: event.id,
      type: event.type,
      apiVersion: event.api_version ?? null,
      payload: event as unknown as Record<string, unknown>,
    })
    .onConflictDoNothing({ target: stripeEvent.id })
    .returning({ id: stripeEvent.id });

  return Boolean(inserted);
}

/**
 * Decides whether a user may act on a subscription reference.
 *
 * What the reference means depends on APP_MODE: the organization that pays, or
 * the person who pays.
 *
 * Reading is separated from managing on purpose: a plain member may see which plan the
 * organization is on without being able to change what it pays.
 *
 * Exported for tests: without `authorizeReference` Better Auth only permits operations
 * where referenceId equals the caller's own id, so getting this wrong is the difference
 * between organization billing working and one tenant managing another's subscription.
 */
export async function canActOnSubscription(
  userId: string,
  referenceId: string,
  action: string,
): Promise<boolean> {
  // When the person pays, the only legitimate reference is the caller themselves.
  // Refusing organization references outright means a stale client cannot create
  // subscriptions this application would never read.
  if (billsThePerson(appMode())) {
    return referenceId === userId;
  }

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, referenceId), eq(member.userId, userId)))
    .limit(1);

  if (!membership) return false;

  const held = permissionsForRole(membership.role as OrgRole);
  const required =
    action === 'list-subscription' ? PERMISSIONS.BILLING_READ : PERMISSIONS.BILLING_MANAGE;

  return held.includes(required);
}

export function createStripePlugin(): ReturnType<typeof stripePlugin> | null {
  const secretKey = process.env['STRIPE_SECRET_KEY'];
  const webhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];
  if (!secretKey || !webhookSecret) return null;

  const stripeClient = new Stripe(secretKey) as unknown as PluginStripeClient;

  return stripePlugin({
    stripeClient,
    stripeWebhookSecret: webhookSecret,

    // A Stripe customer per user, so a personal account can be billed too.
    createCustomerOnSignUp: true,

    // And per organization: the subscription belongs to the tenant, not to whoever
    // happened to click subscribe. Someone leaving must not take the plan with them.
    organization: { enabled: true },

    subscription: {
      enabled: true,

      /**
       * Read from the database rather than hard-coded, so changing a price is a seed
       * or a migration instead of a redeploy — and the pricing page, the checkout and
       * the quota checks cannot disagree about what a plan is.
       */
      plans: async () => {
        const rows = await db.select().from(planTable).where(eq(planTable.isActive, true));

        return (
          rows
            // The free plan has no Stripe price: it is the absence of a subscription.
            .filter((row) => row.stripePriceIdMonthly)
            .map((row) => ({
              name: row.key,
              priceId: row.stripePriceIdMonthly as string,
              ...(row.stripePriceIdYearly
                ? { annualDiscountPriceId: row.stripePriceIdYearly }
                : {}),
              limits: (row.limits ?? {}) as Record<string, unknown>,
            }))
        );
      },

      /**
       * Decides who may act on a subscription, and it is NOT optional.
       *
       * Without it Better Auth only allows operations where referenceId equals the
       * user's own id — which for organization-level billing means every call fails,
       * or worse, succeeds against the wrong reference if the model changes. Here the
       * reference is an organization id, so the question is: is this user a member,
       * and does their role carry the right permission?
       *
       * Reading is separated from managing on purpose: a plain member may see which
       * plan the organization is on without being able to change what it pays.
       */
      authorizeReference: ({ user, referenceId, action }) =>
        canActOnSubscription(user.id, referenceId, action),
    },

    /**
     * Idempotency boundary for everything Stripe sends.
     *
     * The primary key is the Stripe event id, so the insert either succeeds once or
     * conflicts. Stripe retries a failing webhook for up to 72 hours and can deliver
     * the same event more than once even when nothing failed, so "we already handled
     * this" has to be a database fact rather than an assumption.
     */
    onEvent: async (event) => {
      const isNew = await recordStripeEvent(event);
      // Already seen: stop rather than replay whatever side effect it describes.
      if (!isNew) return;

      /**
       * The plugin already turns customer.subscription.* into rows in `subscription`.
       * What it does not cover is the invoice lifecycle, and a failed renewal arrives
       * as `invoice.payment_failed`: an integration that only watches subscription
       * events sees a plan that is still 'active' while the card has stopped working.
       *
       * Logged for now — the notification and dunning flow belongs with the email
       * module. The important part is that the event is recorded rather than dropped.
       */
      if (event.type === 'invoice.payment_failed' || event.type === 'invoice.paid') {
        logger.log(`stripe: ${event.type} (${event.id})`);
      }

      await db
        .update(stripeEvent)
        .set({ processedAt: new Date() })
        .where(eq(stripeEvent.id, event.id));
    },
  });
}
