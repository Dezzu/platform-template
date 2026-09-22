import { inject, Service } from '@angular/core';
import { AUTH_CLIENT } from '../auth/auth.client';

/**
 * Whose Stripe customer the subscription hangs off.
 *
 * Not cosmetic, and not derivable by the plugin: `@better-auth/stripe` defaults it to
 * `'user'`, so leaving it out makes an organization-scoped subscription attach to the
 * Stripe customer of whoever happened to click subscribe. That is precisely what
 * organization billing exists to prevent — the plan must not leave with the person.
 */
export type BillingCustomerType = 'user' | 'organization';

export interface OrgSubscription {
  plan: string;
  status: string;
  seats: number | null;
  periodEnd: string | null;
  cancelAt: string | null;
  /**
   * Set to end rather than renew.
   *
   * Recent Stripe API versions express cancellation with `cancel_at` and leave
   * `cancel_at_period_end` false, so both are considered.
   */
  willNotRenew: boolean;
  trialEnd: string | null;
}

/**
 * Subscriptions, always scoped to an organization.
 *
 * `referenceId` is whatever APP_MODE says pays: the organization, so the plan
 * survives whoever set it up leaving, or the user, for a B2C portal. The server
 * re-checks both the scope and the caller's right to that reference through
 * `authorizeReference` — this class decides nothing.
 */
@Service()
export class BillingService {
  private readonly client = inject(AUTH_CLIENT);

  async list(reference: string): Promise<OrgSubscription[]> {
    const { data } = await this.client.subscription.list({
      query: { referenceId: reference },
    });
    return (data ?? []).map(toSubscription);
  }

  /**
   * Sends the browser to Stripe Checkout.
   *
   * Checkout rather than an embedded form: Stripe hosts the page, so card data never
   * touches this application and PCI scope stays where it belongs.
   */
  async subscribe(options: {
    reference: string;
    customerType: BillingCustomerType;
    plan: string;
    annual?: boolean;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ error?: string }> {
    const { error } = await this.client.subscription.upgrade({
      plan: options.plan,
      referenceId: options.reference,
      // Without this the plugin takes its `'user'` branch and bills the person, even
      // though the reference it was handed is an organization.
      customerType: options.customerType,
      successUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
      annual: options.annual ?? false,
    });
    return error ? { error: error.code ?? 'UNKNOWN' } : {};
  }

  /**
   * Opens the Stripe Customer Portal.
   *
   * Changing plan, updating a card and cancelling all live there rather than being
   * rebuilt here: Stripe keeps it correct across payment methods, dunning and tax, and
   * every screen not written is a screen that cannot drift from what Stripe does.
   */
  async openPortal(options: {
    reference: string;
    customerType: BillingCustomerType;
    returnUrl: string;
  }): Promise<{ error?: string }> {
    const { error } = await this.client.subscription.billingPortal({
      referenceId: options.reference,
      // Same reason as `subscribe`: the default is `'user'`, which opens the portal of
      // the caller's personal Stripe customer rather than the organization's.
      customerType: options.customerType,
      returnUrl: options.returnUrl,
    });
    return error ? { error: error.code ?? 'UNKNOWN' } : {};
  }
}

function toSubscription(row: Record<string, unknown>): OrgSubscription {
  return {
    plan: String(row['plan'] ?? ''),
    status: String(row['status'] ?? 'incomplete'),
    seats: typeof row['seats'] === 'number' ? row['seats'] : null,
    periodEnd: asIso(row['periodEnd']),
    cancelAt: asIso(row['cancelAt']),
    willNotRenew: asIso(row['cancelAt']) !== null || Boolean(row['cancelAtPeriodEnd']),
    trialEnd: asIso(row['trialEnd']),
  };
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value ? value : null;
}
