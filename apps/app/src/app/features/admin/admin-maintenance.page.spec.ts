import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MaintenanceMode } from '@app/contracts';
import { AppError, PermissionsService, ToastService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '../../../testing/alerts';
import { AdminApi } from './admin.api';
import { AdminMaintenancePage } from './admin-maintenance.page';

const OPEN: MaintenanceMode = {
  enabled: false,
  messageKey: null,
  until: null,
  allowRoles: ['superadmin'],
};

function setup(api: Partial<AdminApi>, platform = ['platform.maintenance.manage']) {
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
        useValue: {
          anyOfPlatform: (...required: string[]) => required.some((p) => platform.includes(p)),
          hasPlatform: (p: string) => platform.includes(p),
          refresh: () => Promise.resolve(null),
        },
      },
    ],
  });

  return TestBed.createComponent(AdminMaintenancePage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

const internalsOf = (fixture: { componentInstance: unknown }) =>
  fixture.componentInstance as unknown as {
    setEnabled: (value: boolean) => void;
    toggleRole: (role: 'admin' | 'superadmin') => void;
    isAllowed: (role: 'admin' | 'superadmin') => boolean;
    save: (event: Event) => Promise<void>;
    model: { set: (value: { messageKey: string; until: string }) => void };
  };

const toastKeys = () =>
  TestBed.inject(ToastService)
    .toasts()
    .map((toast) => toast.messageKey);

const submit = () => new Event('submit');

describe('AdminMaintenancePage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('shows the setting as it currently stands', async () => {
    const fixture = setup({
      getMaintenance: () => of({ ...OPEN, enabled: true, messageKey: 'maintenance.upgrading' }),
    });
    await fixture.whenStable();

    expect(internalsOf(fixture).isAllowed('superadmin')).toBe(true);
    expect(page(fixture).textContent).toContain('Manutenzione attiva');
  });

  it('refuses to empty the allow list, rather than letting the server say no later', async () => {
    const setMaintenance = vi.fn(() => of(OPEN));
    const fixture = setup({ getMaintenance: () => of(OPEN), setMaintenance });
    await fixture.whenStable();

    const internals = internalsOf(fixture);
    internals.toggleRole('superadmin');
    await fixture.whenStable();

    // Locking everybody out locks out whoever would reopen: the only way back would
    // be an UPDATE against production.
    expect(internals.isAllowed('superadmin')).toBe(true);
    expect(toastKeys()).toEqual(['maintenance.allowRolesEmpty']);
  });

  it('sends the whole setting, with an empty notice cleared rather than blanked', async () => {
    const setMaintenance = vi.fn(() => of(OPEN));
    const fixture = setup({ getMaintenance: () => of(OPEN), setMaintenance });
    await fixture.whenStable();

    const internals = internalsOf(fixture);
    internals.setEnabled(true);
    internals.toggleRole('admin');
    await internals.save(submit());

    expect(setMaintenance).toHaveBeenCalledWith({
      enabled: true,
      // null, not '': the contract distinguishes "no notice" from "an empty one".
      messageKey: null,
      until: null,
      allowRoles: ['superadmin', 'admin'],
    });
    expect(toastKeys()).toEqual(['maintenance.turnedOn']);
  });

  it('warns the administrator who is about to lock themselves out', async () => {
    const fixture = setup({ getMaintenance: () => of(OPEN), setMaintenance: () => of(OPEN) });
    await fixture.whenStable();

    const internals = internalsOf(fixture);
    internals.setEnabled(true);
    internals.toggleRole('admin');
    internals.toggleRole('superadmin');
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('non rientreresti nemmeno tu');
  });

  it('reports a refusal instead of claiming the product is closed', async () => {
    const fixture = setup({
      getMaintenance: () => of(OPEN),
      setMaintenance: () => throwError(() => new AppError(403, 'FORBIDDEN', 'nope')),
    });
    await fixture.whenStable();

    await internalsOf(fixture).save(submit());
    expect(toastKeys()).toEqual(['errors.FORBIDDEN']);
  });

  it('says so when the setting cannot be read', async () => {
    const fixture = setup({ getMaintenance: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('Si è verificato un errore');
  });
});
