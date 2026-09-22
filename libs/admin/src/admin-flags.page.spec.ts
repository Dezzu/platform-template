import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureFlag } from '@app/contracts';
import type { TableAction } from '@app/ui/mix';
import { AppError, PermissionsService, ToastService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '@app/ui/testing';
import { AdminApi } from './admin.api';
import { AdminFlagsPage } from './admin-flags.page';

const flag = (over: Partial<FeatureFlag> & { key: string }): FeatureFlag => ({
  description: null,
  enabled: false,
  rolloutPercent: 0,
  overrideCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const ON = flag({ key: 'billing.enabled', description: 'Checkout Stripe', enabled: true });
const ROLLING = flag({ key: 'teams.beta', rolloutPercent: 40, overrideCount: 2 });

const pageOf = (items: FeatureFlag[]) =>
  of({ items, meta: { page: 0, size: 10, total: items.length, totalPages: 1 } });

function setup(api: Partial<AdminApi>) {
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
      { provide: AdminApi, useValue: api },
      ToastService,
      {
        provide: PermissionsService,
        // The shared administration tabs read platform rights through *appCanPlatform.
        useValue: { anyOfPlatform: () => true, hasPlatform: () => true },
      },
    ],
  });

  return TestBed.createComponent(AdminFlagsPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

const rowFor = (fixture: { nativeElement: unknown }, text: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(text));

const actionNamed = (fixture: { componentInstance: unknown }, label: string) =>
  (fixture.componentInstance as unknown as { actions: () => TableAction<FeatureFlag>[] })
    .actions()
    .find((action) => action.label === label);

const toastKeys = () =>
  TestBed.inject(ToastService)
    .toasts()
    .map((toast) => toast.messageKey);

/** The command handlers are async internally; let the microtask queue drain. */
const settle = async (fixture: { whenStable: () => Promise<unknown> }) => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
};

describe('AdminFlagsPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists the flags with the state they are actually configured in', async () => {
    const fixture = setup({ listFlags: () => pageOf([ON, ROLLING]) });
    await fixture.whenStable();

    expect(rowFor(fixture, 'billing.enabled')?.textContent).toContain('attivo');
    expect(rowFor(fixture, 'billing.enabled')?.textContent).toContain('Checkout Stripe');
  });

  it('shows the rollout and the exception count, which is what "off" really means here', async () => {
    const fixture = setup({ listFlags: () => pageOf([ROLLING]) });
    await fixture.whenStable();

    // "spento" alone would be a lie for a flag that 40% of tenants are seeing.
    const row = rowFor(fixture, 'teams.beta')?.textContent ?? '';
    expect(row).toContain('spento');
    expect(row).toContain('40');
    expect(row).toContain('2');
  });

  it('flips the global switch from the list and reloads', async () => {
    const listFlags = vi.fn(() => pageOf([ON]));
    const updateFlag = vi.fn(() => of(ON));
    const fixture = setup({ listFlags, updateFlag });
    await fixture.whenStable();

    actionNamed(fixture, 'Attiva o spegni')?.command(ON, []);
    await settle(fixture);

    expect(updateFlag).toHaveBeenCalledWith('billing.enabled', { enabled: false });
    expect(listFlags).toHaveBeenCalledTimes(2);
    expect(toastKeys()).toEqual(['flags.disabled']);
  });

  it('reports a refusal instead of leaving the row looking changed', async () => {
    const fixture = setup({
      listFlags: () => pageOf([ON]),
      updateFlag: () => throwError(() => new AppError(403, 'FORBIDDEN', 'nope')),
    });
    await fixture.whenStable();

    actionNamed(fixture, 'Attiva o spegni')?.command(ON, []);
    await settle(fixture);

    expect(toastKeys()).toEqual(['errors.FORBIDDEN']);
  });

  it('deletes a flag and reloads the list', async () => {
    const listFlags = vi.fn(() => pageOf([ROLLING]));
    const deleteFlag = vi.fn(() => of(undefined as unknown as void));
    const fixture = setup({ listFlags, deleteFlag });
    await fixture.whenStable();

    actionNamed(fixture, 'Elimina')?.command(ROLLING, []);
    await settle(fixture);

    expect(deleteFlag).toHaveBeenCalledWith('teams.beta');
    expect(toastKeys()).toEqual(['flags.deleted']);
  });

  it('opens the form for a flag rather than editing it in the row', async () => {
    const fixture = setup({ listFlags: () => pageOf([ON]) });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    await fixture.whenStable();

    actionNamed(fixture, 'Modifica')?.command(ON, []);
    expect(navigate).toHaveBeenCalledWith(['/admin/flags', 'billing.enabled']);
  });

  it('says so when the list fails, instead of showing an empty table', async () => {
    const fixture = setup({ listFlags: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('Si è verificato un errore');
  });
});
