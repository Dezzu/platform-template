import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BillingService,
  PermissionsService,
  PlansApi,
  provideCore,
  type OrgSubscription,
} from '@app/core';
import { provideI18n } from '@app/i18n';
import { BillingPage } from './billing.page';

const PLAN = {
  id: '11111111-1111-4111-8111-111111111111',
  key: 'pro',
  nameKey: 'plans.pro.name',
  descriptionKey: 'plans.pro.description',
  amountMonthly: 1900,
  amountYearly: 19000,
  currency: 'EUR',
  limits: {},
  features: [],
  sortOrder: 20,
  isDefault: false,
};

function setup(subscriptions: OrgSubscription[]) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideI18n('it'),
      provideCore({
        apiUrl: '/api',
        authUrl: '/api/auth',
        loginRoute: '/sign-in',
        homeRoute: '/dashboard',
        defaultLocale: 'it',
        supportedLocales: ['it', 'en'],
      }),
      { provide: PlansApi, useValue: { list: () => of([PLAN]) } },
      { provide: BillingService, useValue: { list: async () => subscriptions } },
      {
        provide: PermissionsService,
        useValue: {
          organizationId: () => 'org-1',
          billingScope: () => 'organization' as const,
          anyOf: () => true,
          allOf: () => true,
        },
      },
    ],
  });
  return TestBed.createComponent(BillingPage);
}

const active: OrgSubscription = {
  plan: 'pro',
  status: 'active',
  seats: 1,
  periodEnd: '2026-10-17T08:26:44.000Z',
  cancelAt: null,
  willNotRenew: false,
  trialEnd: null,
};

describe('BillingPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('says when a cancelled plan stops, instead of only that it was cancelled', async () => {
    // Recent Stripe API versions leave cancel_at_period_end false and set cancel_at, so
    // a page reading only the boolean shows nothing at all — which is how a cancelled
    // subscription looked identical to a healthy one.
    const fixture = setup([
      { ...active, cancelAt: '2026-10-17T08:26:44.000Z', willNotRenew: true },
    ]);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('17 ottobre 2026');
  });

  it('says nothing about an ending date while the plan is renewing normally', async () => {
    const fixture = setup([active]);
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('non si rinnova');
  });

  it('names the current plan, rather than echoing its machine key', async () => {
    const fixture = setup([active]);
    await fixture.whenStable();

    // Scoped to the current-subscription card: the plan grid renders the same name, so
    // asserting against the whole page would pass even with this line broken.
    const summary = (fixture.nativeElement as HTMLElement).querySelector('section p');
    expect(summary?.textContent).toContain('Pro');
    expect(summary?.textContent).not.toContain('pro ·');
  });

  it('never renders a raw translation key', async () => {
    const fixture = setup([active]);
    await fixture.whenStable();

    // A missing translation renders the key itself. It looks like a broken page and no
    // other check sees it — the plan names shipped this way until someone opened the
    // screen and read 'plans.pro.name'.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toMatch(/\b[a-z]+\.[a-z][\w.]*\.(name|description|title)\b/);
  });
});
