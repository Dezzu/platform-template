import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminUser } from '@app/contracts';
import type { TableAction } from '@app/ui/mix';
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

const pageOf = (items: AdminUser[]) =>
  of({ items, meta: { page: 0, size: 10, total: items.length, totalPages: 1 } });

/**
 * The row actions live behind the three dots, and the menu only exists once it is
 * opened — a CDK overlay, not markup on the page. Asserting on which actions a row is
 * offered therefore reads the component's own action list and runs each `visible`
 * predicate, which *is* the logic: `visible` is where the server's rank rules are
 * mirrored. The DOM cases below cover that the page renders and that the trigger
 * appears only where there is something to offer.
 */
interface Internals {
  actions: () => TableAction<AdminUser>[];
}

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

/**
 * Settles a rejected promise as well as the render that follows it. `whenStable` alone
 * returns before a `catch` in an action handler has run.
 */
async function settle(fixture: { whenStable: () => Promise<unknown> }): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

/** Reaches the component's protected members, which is what these cases are about. */
const internalsOf = (fixture: { componentInstance: unknown }): Internals =>
  fixture.componentInstance as unknown as Internals;

/** The labels of the actions this row is actually offered. */
function offered(fixture: { componentInstance: unknown }, row: AdminUser): string[] {
  return internalsOf(fixture)
    .actions()
    .filter((action) => action.visible?.(row, []) ?? true)
    .map((action) => (typeof action.label === 'function' ? action.label(row, []) : action.label))
    .filter((label): label is string => label !== undefined);
}

const rowFor = (fixture: { nativeElement: unknown }, email: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(email));

describe('AdminUsersPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders the accounts in a table', async () => {
    const fixture = setup({ listUsers: () => pageOf([SUPER, PLAIN]) });
    await fixture.whenStable();

    expect(page(fixture).querySelector('table')).not.toBeNull();
    expect(page(fixture).textContent).toContain('plain@test.local');
    expect(page(fixture).textContent).toContain('super@test.local');
  });

  it('says so when the list fails, instead of a blank screen', async () => {
    const fixture = setup({ listUsers: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    // A resource in an error state throws from `value()`, so reading it optimistically
    // takes the render down and the message never appears. Not a bare querySelector:
    // the table's search input renders a hidden `role="alert"` of its own.
    expect(pageAlerts(fixture)).toContain('Si è verificato un errore');
  });

  it('asks the server again when the table changes page or search', async () => {
    const listUsers = vi.fn(() => pageOf([PLAIN]));
    const fixture = setup({ listUsers });
    await fixture.whenStable();

    const internals = fixture.componentInstance as unknown as {
      onLazyLoad: (event: {
        pageRequest: {
          page: number;
          size: number;
          query: string;
          sortField: null;
          sortOrder: null;
        };
      }) => void;
    };
    internals.onLazyLoad({
      pageRequest: { page: 2, size: 10, query: 'erika', sortField: null, sortOrder: null },
    });
    await fixture.whenStable();

    // Filtering client-side would silently mean "search the page you are looking at".
    expect(listUsers).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, size: 10, q: 'erika' }),
    );
  });

  it('offers an admin nothing at all on a superadmin', async () => {
    const fixture = setup(
      { listUsers: () => pageOf([SUPER, PLAIN]) },
      { id: 'admin', role: 'admin' },
    );
    await fixture.whenStable();

    expect(offered(fixture, SUPER)).toEqual([]);
    expect(offered(fixture, PLAIN).length).toBeGreaterThan(0);

    // And with nothing to offer, the three dots do not appear either.
    expect(rowFor(fixture, 'super@test.local')?.querySelector('button')).toBeNull();
    expect(rowFor(fixture, 'plain@test.local')?.querySelector('button')).not.toBeNull();
  });

  it('offers an admin only the roles an admin may grant', async () => {
    const fixture = setup({ listUsers: () => pageOf([PLAIN]) }, { id: 'admin', role: 'admin' });
    await fixture.whenStable();

    const labels = offered(fixture, PLAIN);
    expect(labels).toContain('Rendi Amministratore di piattaforma');
    expect(labels).not.toContain('Rendi Super amministratore');
    // The role it already holds is not offered: an entry that would do nothing.
    expect(labels).not.toContain('Rendi Utente');
  });

  it('does not offer to change your own role, nor to ban yourself', async () => {
    const fixture = setup({ listUsers: () => pageOf([SUPER, PLAIN]) });
    await fixture.whenStable();

    const own = offered(fixture, SUPER);
    // Server-side both are refused: the last superadmin demoting themselves is a lockout.
    expect(own.some((label) => label.startsWith('Rendi'))).toBe(false);
    expect(own).not.toContain('Sospendi');
    // The harmless ones are still there.
    expect(own).toContain('Invia reset password');
  });

  it('shows a ban as a ban, and offers to lift it', async () => {
    const banned = account({ id: 'banned', banned: true, banReason: 'spam' });
    const fixture = setup({ listUsers: () => pageOf([banned]) });
    await fixture.whenStable();

    expect(rowFor(fixture, 'banned@test.local')?.textContent).toContain('sospeso');

    const labels = offered(fixture, banned);
    expect(labels).toContain('Riattiva');
    expect(labels).not.toContain('Sospendi');
  });

  it('says the reset link was queued, without pretending the account changed', async () => {
    const listUsers = vi.fn(() => pageOf([PLAIN]));
    const sendPasswordReset = vi.fn(() => of(undefined));
    const fixture = setup({ listUsers, sendPasswordReset });
    await fixture.whenStable();

    const action = internalsOf(fixture)
      .actions()
      .find((a) => a.label === 'Invia reset password');
    action?.command(PLAIN, []);
    await settle(fixture);

    expect(sendPasswordReset).toHaveBeenCalledWith(PLAIN.id);
    expect(page(fixture).querySelector('[role="status"]')?.textContent).toContain('accodato');
    // Nothing about the account changed, so the list must not be refetched.
    expect(listUsers).toHaveBeenCalledTimes(1);
  });

  it('translates a refusal from the API', async () => {
    const fixture = setup({
      listUsers: () => pageOf([PLAIN]),
      setRole: () => throwError(() => new AppError(403, 'CANNOT_GRANT_HIGHER_ROLE', 'nope')),
    });
    await fixture.whenStable();

    const promote = internalsOf(fixture)
      .actions()
      .find((a) => a.label === 'Rendi Amministratore di piattaforma');
    promote?.command(PLAIN, []);
    await settle(fixture);

    expect(pageAlerts(fixture)).toContain('ruolo superiore al tuo');
  });

  it('offers nothing to someone who may only read', async () => {
    const fixture = setup({ listUsers: () => pageOf([PLAIN]) }, { id: 'admin', role: 'admin' }, [
      'platform.users.read',
    ]);
    await fixture.whenStable();

    expect(offered(fixture, PLAIN)).toEqual([]);
    expect(rowFor(fixture, 'plain@test.local')?.querySelector('button')).toBeNull();
  });
});
