import { Component, computed, inject, resource, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
// Constants from the deep path so this route's chunk does not pull in Zod.
import { PERMISSIONS } from '@app/contracts/permissions';
import type { Plan as PlanDto } from '@app/contracts';
import {
  BillingService,
  CanDirective,
  PermissionsService,
  PlansApi,
  type OrgSubscription,
} from '@app/core';

@Component({
  selector: 'app-billing-page',
  imports: [TranslocoPipe, HlmButtonImports, HlmCardImports, CanDirective],
  templateUrl: './billing.page.html',
})
export class BillingPage {
  private readonly plansApi = inject(PlansApi);
  private readonly billing = inject(BillingService);
  private readonly permissions = inject(PermissionsService);

  protected readonly permissionKeys = PERMISSIONS;
  protected readonly errorKey = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly plans = resource({
    loader: () => firstValueFrom(this.plansApi.list()),
  });

  protected readonly subscriptions = resource({
    params: () => ({ organizationId: this.permissions.organizationId() }),
    loader: ({ params }): Promise<OrgSubscription[]> =>
      params.organizationId ? this.billing.list(params.organizationId) : Promise.resolve([]),
  });

  /** The plan actually being paid for, if any. */
  protected readonly current = computed<OrgSubscription | null>(() => {
    const rows = this.subscriptions.value() ?? [];
    return rows.find((row) => row.status === 'active' || row.status === 'trialing') ?? null;
  });

  protected isCurrent(plan: PlanDto): boolean {
    return this.current()?.plan === plan.key;
  }

  protected async subscribe(plan: PlanDto): Promise<void> {
    const organizationId = this.permissions.organizationId();
    if (!organizationId || this.busy()) return;

    this.busy.set(true);
    this.errorKey.set(null);

    const origin = window.location.origin;
    const { error } = await this.billing.subscribe({
      organizationId,
      plan: plan.key,
      successUrl: `${origin}/billing?checkout=success`,
      cancelUrl: `${origin}/billing?checkout=cancelled`,
    });

    if (error) {
      this.busy.set(false);
      // Almost always a missing or misconfigured Stripe key in development; the real
      // message is in the API log, and showing the raw code here would help nobody.
      this.errorKey.set('billing.checkoutFailed');
    }
  }

  protected async openPortal(): Promise<void> {
    const organizationId = this.permissions.organizationId();
    if (!organizationId || this.busy()) return;

    this.busy.set(true);
    this.errorKey.set(null);

    const { error } = await this.billing.openPortal(
      organizationId,
      `${window.location.origin}/billing`,
    );
    if (error) {
      this.busy.set(false);
      this.errorKey.set('billing.portalFailed');
    }
  }

  protected formatPrice(plan: PlanDto): string {
    if (plan.amountMonthly === 0) return '—';
    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: plan.currency,
      maximumFractionDigits: 0,
    }).format(plan.amountMonthly / 100);
  }
}
