import { Component, computed, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
// Constants from the deep path so this route's chunk does not pull in Zod.
import { PERMISSIONS } from '@app/contracts/permissions';
import type { Plan as PlanDto } from '@app/contracts';
import {
  AuthService,
  BillingService,
  CanDirective,
  PermissionsService,
  PlansApi,
  type OrgSubscription,
} from '@app/core';

@Component({
  selector: 'app-billing-page',
  imports: [TranslocoPipe, NgIcon, HlmButtonImports, HlmCardImports, CanDirective],
  providers: [provideIcons({ lucideCheck })],
  templateUrl: './billing.page.html',
})
export class BillingPage {
  private readonly plansApi = inject(PlansApi);
  private readonly billing = inject(BillingService);
  private readonly permissions = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly transloco = inject(TranslocoService);

  /**
   * Formatting follows the interface language.
   *
   * `Intl` was pinned to 'it-IT' here, so an English reader saw prices and dates in
   * Italian conventions — a full stop where they expect a comma, "18 settembre".
   */
  private readonly locale = toSignal(this.transloco.langChanges$, {
    initialValue: this.transloco.getActiveLang(),
  });

  protected readonly permissionKeys = PERMISSIONS;

  /**
   * What the subscription hangs off, decided by the server through BILLING_SCOPE:
   * the organization that pays, or the person who pays. The server refuses the other
   * kind of reference outright, so this is not merely a display choice.
   */
  protected readonly reference = computed(() =>
    this.permissions.billingScope() === 'user'
      ? (this.auth.user()?.id ?? null)
      : this.permissions.organizationId(),
  );
  protected readonly errorKey = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly plans = resource({
    loader: () => firstValueFrom(this.plansApi.list()),
  });

  protected readonly subscriptions = resource({
    params: () => ({ reference: this.reference() }),
    loader: ({ params }): Promise<OrgSubscription[]> =>
      params.reference ? this.billing.list(params.reference) : Promise.resolve([]),
  });

  /** The plan actually being paid for, if any. */
  protected readonly current = computed<OrgSubscription | null>(() => {
    const rows = this.subscriptions.value() ?? [];
    return rows.find((row) => row.status === 'active' || row.status === 'trialing') ?? null;
  });

  /**
   * Which plan you are on.
   *
   * No subscription means the default plan, not "no plan": somebody on Free is on
   * Free. Before this, that card was marked as nothing at all and its footer rendered
   * an empty space where every other card had a button.
   */
  protected isCurrent(plan: PlanDto): boolean {
    const subscription = this.current();
    return subscription ? subscription.plan === plan.key : plan.isDefault;
  }

  protected async subscribe(plan: PlanDto): Promise<void> {
    const reference = this.reference();
    if (!reference || this.busy()) return;

    this.busy.set(true);
    this.errorKey.set(null);

    const origin = window.location.origin;
    const { error } = await this.billing.subscribe({
      reference,
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
    const reference = this.reference();
    if (!reference || this.busy()) return;

    this.busy.set(true);
    this.errorKey.set(null);

    const { error } = await this.billing.openPortal(reference, `${window.location.origin}/billing`);
    if (error) {
      this.busy.set(false);
      this.errorKey.set('billing.portalFailed');
    }
  }

  protected formatDate(iso: string): string {
    return new Intl.DateTimeFormat(this.locale(), { dateStyle: 'long' }).format(new Date(iso));
  }

  protected formatPrice(plan: PlanDto): string {
    if (plan.amountMonthly === 0) return this.transloco.translate('billing.free');
    return this.money(plan.amountMonthly, plan.currency);
  }

  protected formatYearly(plan: PlanDto): string {
    return this.money(plan.amountYearly, plan.currency);
  }

  /**
   * What paying yearly saves, or null when it saves nothing.
   *
   * Computed rather than stored: a saving that is written down separately from the two
   * prices is a saving that goes stale the first time one of them changes.
   */
  protected yearlySaving(plan: PlanDto): string | null {
    if (plan.amountMonthly === 0 || plan.amountYearly === 0) return null;
    const saving = plan.amountMonthly * 12 - plan.amountYearly;
    return saving > 0 ? this.money(saving, plan.currency) : null;
  }

  /** The quota rows, in the order the plan declares them. */
  protected limitsOf(plan: PlanDto): { key: string; value: number }[] {
    return Object.entries(plan.limits).map(([key, value]) => ({ key, value }));
  }

  /**
   * A quota's label. The key comes from the `limits` object, so adding a quota means
   * adding `plans.limits.<key>` to both locales — the same rule as every other string.
   */
  protected limitLabel(key: string): string {
    return `plans.limits.${key}`;
  }

  /** True for a quota with no ceiling. Rendered as a symbol, spoken as a word. */
  protected isUnlimited(value: number): boolean {
    return value < 0;
  }

  /**
   * A quota's value. Only storage needs converting, and only because its unit is baked
   * into the key: every other quota is a count of things and reads as one.
   */
  protected formatLimit(key: string, value: number): string {
    if (value < 0) return '∞';
    if (key !== 'storageMb') return new Intl.NumberFormat(this.locale()).format(value);

    const gigabytes = value / 1024;
    return gigabytes >= 1
      ? `${new Intl.NumberFormat(this.locale(), { maximumFractionDigits: 0 }).format(gigabytes)} GB`
      : `${new Intl.NumberFormat(this.locale()).format(value)} MB`;
  }

  private money(amountInCents: number, currency: string): string {
    return new Intl.NumberFormat(this.locale(), {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(amountInCents / 100);
  }
}
