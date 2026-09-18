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

const FREE = {
  id: '22222222-2222-4222-8222-222222222222',
  key: 'free',
  nameKey: 'plans.free.name',
  descriptionKey: 'plans.free.description',
  amountMonthly: 0,
  amountYearly: 0,
  currency: 'EUR',
  limits: { members: 2, projects: 3, storageMb: 100 },
  features: ['plans.features.basic'],
  sortOrder: 10,
  isDefault: true,
};

const BUSINESS = {
  ...PLAN,
  id: '33333333-3333-4333-8333-333333333333',
  key: 'business',
  nameKey: 'plans.business.name',
  descriptionKey: 'plans.business.description',
  amountMonthly: 4900,
  amountYearly: 49000,
  limits: { members: 100, projects: -1, storageMb: 102400 },
  features: ['plans.features.priority_support'],
  sortOrder: 30,
};

function setup(subscriptions: OrgSubscription[], plans: unknown[] = [PLAN]) {
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
      { provide: PlansApi, useValue: { list: () => of(plans) } },
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

const text = (fixture: { nativeElement: unknown }) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

/**
 * Matched on the heading, not on the card's text: "Pro" appears inside the Free plan's
 * own description ("Per iniziare e valutare il prodotto"), so a substring search over
 * the whole card picks the wrong one.
 */
const cardFor = (fixture: { nativeElement: unknown }, name: string) =>
  [...(fixture.nativeElement as HTMLElement).querySelectorAll('article')].find(
    (card) => card.querySelector('h3')?.textContent?.trim() === name,
  );

describe('BillingPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('the plan cards', () => {
    it('shows the quotas, which is what the plans actually differ by', async () => {
      const fixture = setup([], [FREE, BUSINESS]);
      await fixture.whenStable();

      const free = cardFor(fixture, 'Gratuito');
      expect(free?.textContent).toContain('Membri');
      expect(free?.textContent).toContain('2');
      expect(free?.textContent).toContain('Progetti');
      // Storage carries its unit in the key, and only it needs converting.
      expect(free?.textContent).toContain('100 MB');
      expect(cardFor(fixture, 'Business')?.textContent).toContain('100 GB');
    });

    it('draws no ceiling as a symbol, and says the word for a screen reader', async () => {
      const fixture = setup([], [BUSINESS]);
      await fixture.whenStable();

      const business = cardFor(fixture, 'Business');
      expect(business?.textContent).toContain('∞');
      // A symbol alone is read out inconsistently, or not at all.
      expect(business?.querySelector('.sr-only')?.textContent?.trim()).toBe('Illimitati');
    });

    it('works out what paying yearly saves, rather than stating it separately', async () => {
      const fixture = setup([], [PLAN]);
      await fixture.whenStable();

      // 1900 × 12 − 19000 = 3800. A figure written down next to the two prices would
      // go stale the first time one of them changed.
      expect(text(fixture)).toContain('38');
    });

    it('offers no yearly saving when there is none', async () => {
      const noSaving = { ...PLAN, amountYearly: 1900 * 12 };
      const fixture = setup([], [noSaving]);
      await fixture.whenStable();

      expect(text(fixture)).not.toContain('risparmi');
    });

    it('marks the default plan as current when nothing is subscribed', async () => {
      const fixture = setup([], [FREE, PLAN]);
      await fixture.whenStable();

      // Somebody on Free is on Free — not on nothing.
      expect(cardFor(fixture, 'Gratuito')?.textContent).toContain('Piano attuale');
      expect(cardFor(fixture, 'Pro')?.textContent).not.toContain('Piano attuale');
    });

    it('moves the marker onto the plan being paid for', async () => {
      const fixture = setup([active], [FREE, PLAN]);
      await fixture.whenStable();

      expect(cardFor(fixture, 'Pro')?.textContent).toContain('Piano attuale');
      expect(cardFor(fixture, 'Gratuito')?.textContent).not.toContain('Piano attuale');
    });

    it('names the plan on its own button, so the action says what it does', async () => {
      const fixture = setup([], [FREE, PLAN]);
      await fixture.whenStable();

      expect(cardFor(fixture, 'Pro')?.querySelector('button')?.textContent).toContain('Pro');
      // Nothing to buy on the plan you already have.
      expect(cardFor(fixture, 'Gratuito')?.querySelector('button')).toBeNull();
    });
  });

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
