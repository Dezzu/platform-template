import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrganization } from '@app/contracts';
import type { TableAction } from '@app/ui/mix';
import { PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '@app/ui/testing';
import { AdminApi } from './admin.api';
import { AdminOrganizationsPage } from './admin-organizations.page';

const organization = (over: Partial<AdminOrganization> & { id: string }): AdminOrganization => ({
  name: `Org ${over.id}`,
  slug: over.id,
  logo: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  memberCount: 3,
  subscription: null,
  ...over,
});

const ACME = organization({ id: 'acme', name: 'Acme Srl' });
const PAID = organization({
  id: 'paid',
  name: 'Paying Ltd',
  subscription: { plan: 'pro', status: 'active', periodEnd: null },
});

const pageOf = (items: AdminOrganization[]) =>
  of({ items, meta: { page: 0, size: 10, total: items.length, totalPages: 1 } });

let navigate: ReturnType<typeof vi.spyOn>;

function setup(api: Partial<AdminApi>, platform: string[] = ['platform.users.read']) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: PermissionsService,
        useValue: { anyOfPlatform: (...req: string[]) => req.some((p) => platform.includes(p)) },
      },
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
    ],
  });
  /**
   * The real Router with its `navigate` spied on, rather than a stub: `RouterLink` in
   * the template reads more of it than a stub can plausibly fake, and these cases are
   * about *where* the action goes, not about the navigation happening.
   */
  navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

  return TestBed.createComponent(AdminOrganizationsPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

/** Reaches the component's protected action list, which is where the logic lives. */
const internalsOf = (fixture: { componentInstance: unknown }) =>
  fixture.componentInstance as unknown as { actions: () => TableAction<AdminOrganization>[] };

const rowFor = (fixture: { nativeElement: unknown }, text: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(text));

describe('AdminOrganizationsPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders the organizations in a table, with their member count', async () => {
    const fixture = setup({ listOrganizations: () => pageOf([ACME, PAID]) });
    await fixture.whenStable();

    expect(page(fixture).querySelector('table')).not.toBeNull();
    expect(rowFor(fixture, 'Acme Srl')?.textContent).toContain('3');
  });

  it('names the plan, and says so when there is none', async () => {
    const fixture = setup({ listOrganizations: () => pageOf([ACME, PAID]) });
    await fixture.whenStable();

    expect(rowFor(fixture, 'Paying Ltd')?.textContent).toContain('Pro');
    expect(rowFor(fixture, 'Acme Srl')?.textContent).toContain('nessun piano');
  });

  it('offers an action that leads to the users of that organization', async () => {
    const fixture = setup({ listOrganizations: () => pageOf([ACME]) });
    await fixture.whenStable();

    const actions = internalsOf(fixture).actions();
    expect(actions).toHaveLength(1);
    expect(actions[0]?.label).toBe('Gestisci gli utenti');

    actions[0]?.command(ACME, []);
    await fixture.whenStable();

    // The filter travels in the URL, not in component state: it has to survive a
    // reload and a copied link.
    expect(navigate).toHaveBeenCalledWith(['/admin/users'], {
      queryParams: { organizationId: 'acme' },
    });
  });

  it('hides the action from someone who cannot open the users screen', async () => {
    const fixture = setup({ listOrganizations: () => pageOf([ACME]) }, [
      'platform.organizations.read',
    ]);
    await fixture.whenStable();

    const actions = internalsOf(fixture).actions();
    expect(actions[0]?.visible?.(ACME, [])).toBe(false);
  });

  it('asks the server again when the table changes page or search', async () => {
    const listOrganizations = vi.fn(() => pageOf([ACME]));
    const fixture = setup({ listOrganizations });
    await fixture.whenStable();

    const internals = fixture.componentInstance as unknown as {
      onLazyLoad: (event: {
        pageRequest: {
          page: number;
          size: number;
          query: string;
          sortField: string;
          sortOrder: number;
        };
      }) => void;
    };
    internals.onLazyLoad({
      pageRequest: { page: 1, size: 10, query: 'acme', sortField: 'name', sortOrder: -1 },
    });
    await fixture.whenStable();

    expect(listOrganizations).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, q: 'acme', sort: 'name', dir: 'desc' }),
    );
    // Once on init, once for the change — not twice on init.
    expect(listOrganizations).toHaveBeenCalledTimes(2);
  });

  it('says so when the list fails, instead of showing an empty table', async () => {
    const fixture = setup({ listOrganizations: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    // Not a bare querySelector: the table's own search input renders a hidden
    // `role="alert"` slot, which would satisfy the assertion on its own.
    expect(pageAlerts(fixture)).toContain('Si è verificato un errore');
  });
});
