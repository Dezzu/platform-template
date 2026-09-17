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
 * `referenceId` is the organization id, never the user id: the plan belongs to the
 * tenant, so someone leaving must not take it with them. The server re-checks that the
 * caller may act on that reference through `authorizeReference` — this class decides
 * nothing about permissions.
 */
@Service()
export class BillingService {
  private readonly client = inject(AUTH_CLIENT);

  async list(organizationId: string): Promise<OrgSubscription[]> {
    const { data } = await this.client.subscription.list({
      query: { referenceId: organizationId },
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
    organizationId: string;
    plan: string;
    annual?: boolean;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ error?: string }> {
    const { error } = await this.client.subscription.upgrade({
      plan: options.plan,
      referenceId: options.organizationId,
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
  async openPortal(organizationId: string, returnUrl: string): Promise<{ error?: string }> {
    const { error } = await this.client.subscription.billingPortal({
      referenceId: organizationId,
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
