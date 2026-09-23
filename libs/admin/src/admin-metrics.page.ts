import { Component, computed, inject, resource, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import type { PlanBreakdown } from '@app/contracts';
import { TrendChartComponent } from '@app/ui/chart';
import { AdminApi } from './admin.api';
import { AdminNavComponent } from './admin-nav.component';

/** A headline figure. `hint` is already translated; `tone` only colours the hint. */
interface Tile {
  labelKey: string;
  value: string;
  hint?: string | undefined;
  tone?: 'up' | 'down' | undefined;
}

/**
 * Usage and revenue for the whole platform.
 *
 * Two blocks and they are in this order for a reason: usage first, money second. The
 * numbers that move are the ones about people — signups, who came back — and revenue
 * is what happens a while after they move. A dashboard that opens on MRR invites
 * watching the number that reacts last.
 *
 * The figures are a snapshot, not a live feed, and the screen says when it was taken
 * next to a button that takes a new one. Pretending otherwise is how a decision gets
 * made on a five-minute-old number by somebody who thought it was current.
 */
@Component({
  selector: 'app-admin-metrics-page',
  imports: [
    DatePipe,
    TranslocoPipe,
    AdminNavComponent,
    TrendChartComponent,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './admin-metrics.page.html',
})
export class AdminMetricsPage {
  private readonly api = inject(AdminApi);

  /** Bumped by the refresh button; re-runs the loader asking the server to recompute. */
  private readonly refreshedAt = signal(0);

  private readonly snapshot = resource({
    params: () => this.refreshedAt(),
    loader: ({ params }) => firstValueFrom(this.api.metrics(params > 0)),
  });

  /** `hasValue()` rather than `value() ?? …`: a resource in error throws from value(). */
  protected readonly data = computed(() =>
    this.snapshot.hasValue() ? this.snapshot.value() : null,
  );
  protected readonly loading = computed(() => this.snapshot.isLoading());
  protected readonly failed = computed(() => this.snapshot.error() !== undefined);

  protected readonly usageTiles = computed<Tile[]>(() => {
    const data = this.data();
    if (!data) return [];

    const trend = data.usage.signupsTrendPercent;

    return [
      { labelKey: 'metrics.usage.users', value: format(data.usage.users) },
      {
        labelKey: 'metrics.usage.activeOrganizations',
        value: format(data.usage.activeOrganizations),
        hint: `${format(data.usage.organizations)}`,
      },
      { labelKey: 'metrics.usage.dau', value: format(data.usage.dau) },
      { labelKey: 'metrics.usage.wau', value: format(data.usage.wau) },
      { labelKey: 'metrics.usage.mau', value: format(data.usage.mau) },
      {
        labelKey: 'metrics.usage.signups30',
        value: format(data.usage.signupsLast30Days),
        // Null when the previous window was empty — see the contract on why that is
        // not the same as zero.
        hint: trend === null ? undefined : `${trend > 0 ? '+' : ''}${trend}%`,
        tone: trend === null ? undefined : trend >= 0 ? 'up' : 'down',
      },
    ];
  });

  protected readonly revenueTiles = computed<Tile[]>(() => {
    const data = this.data();
    if (!data) return [];

    const money = (cents: number) => formatMoney(cents, data.revenue.currency);

    return [
      { labelKey: 'metrics.revenue.mrr', value: money(data.revenue.mrrCents) },
      { labelKey: 'metrics.revenue.arr', value: money(data.revenue.arrCents) },
      { labelKey: 'metrics.revenue.arpa', value: money(data.revenue.arpaCents) },
      {
        labelKey: 'metrics.revenue.active',
        value: format(data.revenue.activeSubscriptions),
        hint: `${format(data.revenue.trialingSubscriptions)}`,
      },
      {
        labelKey: 'metrics.revenue.cancelling',
        value: format(data.revenue.cancellingSubscriptions),
        tone: data.revenue.cancellingSubscriptions > 0 ? 'down' : undefined,
      },
      { labelKey: 'metrics.revenue.churned30', value: format(data.revenue.churnedLast30Days) },
    ];
  });

  /**
   * Bar widths as a percentage of the largest plan, not of the total.
   *
   * Against the total, a catalogue where one plan carries everything draws every other
   * bar as a line one pixel wide — which says "small" where the honest reading is
   * "smaller than the leader". The number next to each bar is the actual figure.
   */
  protected readonly planBars = computed(() => {
    const plans = this.data()?.plans ?? [];
    const max = Math.max(1, ...plans.map((p) => p.mrrCents));

    return plans.map((plan: PlanBreakdown) => ({
      ...plan,
      percent: Math.round((plan.mrrCents / max) * 100),
      money: formatMoney(plan.mrrCents, this.data()?.revenue.currency ?? 'EUR'),
    }));
  });

  protected refresh(): void {
    this.refreshedAt.update((value) => value + 1);
  }
}

function format(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/**
 * Minor units in, a currency out. Rounded to whole units on purpose: a dashboard
 * showing MRR to the cent invites reading a rounding difference as a change.
 */
function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
