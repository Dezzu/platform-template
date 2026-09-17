import { inject, Service } from '@angular/core';
import { AUTH_CLIENT } from '../auth/auth.client';

export interface OrgSubscription {
  plan: string;
  status: string;
  seats: number | null;
  periodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  trialEnd: string | null;
}

/**
 * Subscriptions, always scoped to an organization.
 *
 * `referenceId` is whatever BILLING_SCOPE says pays: the organization, so the plan
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
    plan: string;
    annual?: boolean;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ error?: string }> {
    const { error } = await this.client.subscription.upgrade({
      plan: options.plan,
      referenceId: options.reference,
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
  async openPortal(reference: string, returnUrl: string): Promise<{ error?: string }> {
    const { error } = await this.client.subscription.billingPortal({
      referenceId: reference,
      returnUrl,
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
    cancelAtPeriodEnd: Boolean(row['cancelAtPeriodEnd']),
    trialEnd: asIso(row['trialEnd']),
  };
}

function asIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value ? value : null;
}
