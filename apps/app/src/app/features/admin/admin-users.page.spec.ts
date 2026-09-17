import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser } from '@app/contracts';
import { AppError, AuthService, PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '../../../testing/alerts';
import { AdminApi } from './admin.api';
import { AdminUsersPage } from './admin-users.page';

const account = (over: Partial<AdminUser> & { id: string }): AdminUser => ({
  email: `${over.id}@test.local`,
  name: `User ${over.id}`,
  image: null,
  emailVerified: true,
  twoFactorEnabled: false,
  role: 'user',
  banned: false,
  banReason: null,
  banExpires: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  organizationCount: 1,
  ...over,
});

const SUPER = account({ id: 'super', role: 'superadmin' });
const PLAIN = account({ id: 'plain', role: 'user' });

const listOf = (items: AdminUser[]) =>
  of({ items, meta: { page: 0, size: 50, total: items.length, totalPages: 1 } });

function setup(
  api: Partial<AdminApi>,
  viewer: { id: string; role: string } = { id: 'super', role: 'superadmin' },
  platform: string[] = ['platform.users.read', 'platform.users.manage'],
) {
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
      { provide: AuthService, useValue: { user: () => viewer } },
      {
        provide: PermissionsService,
        useValue: {
          anyOfPlatform: (...required: string[]) => required.some((p) => platform.includes(p)),
          anyOf: () => true,
          allOf: () => true,
        },
      },
    ],
  });
  return TestBed.createComponent(AdminUsersPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;
const rowFor = (fixture: { nativeElement: unknown }, email: string) =>
  [...page(fixture).querySelectorAll('li')].find((row) => row.textContent?.includes(email));

describe('AdminUsersPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists every account with its organization count', async () => {
    const fixture = setup({ listUsers: () => listOf([SUPER, PLAIN]) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('plain@test.local');
    expect(page(fixture).textContent).toContain('1 organizzazioni');
  });

  it('offers an admin no control over a superadmin', async () => {
    const fixture = setup(
      { listUsers: () => listOf([SUPER, PLAIN]) },
      { id: 'admin', role: 'admin' },
    );
    await fixture.whenStable();

    const superRow = rowFor(fixture, 'super@test.local');
    const plainRow = rowFor(fixture, 'plain@test.local');

    // The API refuses either way; offering the button means a 403 per click, and a
    // support person believing they did something they did not.
    expect(superRow?.querySelector('select')).toBeNull();
    expect(superRow?.querySelector('button')).toBeNull();
    expect(plainRow?.querySelector('select')).not.toBeNull();
  });

  it('offers an admin only the roles an admin may grant', async () => {
    const fixture = setup({ listUsers: () => listOf([PLAIN]) }, { id: 'admin', role: 'admin' });
    await fixture.whenStable();

    const options = [
      ...(rowFor(fixture, 'plain@test.local')?.querySelectorAll('option') ?? []),
    ].map((o) => o.getAttribute('value'));
    // PLATFORM_ROLES order, least privileged first.
    expect(options).toEqual(['user', 'admin']);
    expect(options).not.toContain('superadmin');
  });

  it('does not offer to change your own role, nor to ban yourself', async () => {
    const fixture = setup({ listUsers: () => listOf([SUPER, PLAIN]) });
    await fixture.whenStable();

    const own = rowFor(fixture, 'super@test.local');
    // Server-side this is a 409: the last superadmin demoting themselves is a lockout.
    expect(own?.querySelector('select')).toBeNull();
    const labels = [...(own?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Sospendi');
    // The harmless ones are still there.
    expect(labels).toContain('Invia reset password');
  });

  it('shows a ban as a ban, and offers to lift it', async () => {
    const banned = account({ id: 'banned', banned: true, banReason: 'spam' });
    const fixture = setup({ listUsers: () => listOf([banned]) });
    await fixture.whenStable();

    const row = rowFor(fixture, 'banned@test.local');
    expect(row?.textContent).toContain('sospeso');
    expect(
      [...(row?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim()),
    ).toContain('Riattiva');
  });

  it('says the reset link was queued, without pretending the account changed', async () => {
    const listUsers = vi.fn(() => listOf([PLAIN]));
    const fixture = setup({ listUsers, sendPasswordReset: () => of(undefined) });
    await fixture.whenStable();

    const button = [
      ...(rowFor(fixture, 'plain@test.local')?.querySelectorAll('button') ?? []),
    ].find((b) => b.textContent?.includes('Invia reset password')) as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(page(fixture).querySelector('[role="status"]')?.textContent).toContain('accodato');
    // Nothing about the account changed, so the list must not be refetched.
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('translates a refusal from the API', async () => {
    const fixture = setup({
      listUsers: () => listOf([PLAIN]),
      setRole: () => throwError(() => new AppError(403, 'CANNOT_GRANT_HIGHER_ROLE', 'nope')),
    });
    await fixture.whenStable();

    const select = rowFor(fixture, 'plain@test.local')?.querySelector(
      'select',
    ) as HTMLSelectElement;
    select.value = 'admin';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('ruolo superiore al tuo');
  });

  it('hides every control from someone who may only read', async () => {
    const fixture = setup({ listUsers: () => listOf([PLAIN]) }, { id: 'admin', role: 'admin' }, [
      'platform.users.read',
    ]);
    await fixture.whenStable();

    const row = rowFor(fixture, 'plain@test.local');
    expect(row?.querySelector('select')).toBeNull();
    expect(row?.querySelector('button')).toBeNull();
  });
});
