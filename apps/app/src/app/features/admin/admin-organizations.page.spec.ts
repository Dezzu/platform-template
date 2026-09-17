import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOrganization, AdminOrganizationDetail } from '@app/contracts';
import { provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '../../../testing/alerts';
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

const detailOf = (base: AdminOrganization): AdminOrganizationDetail => ({
  ...base,
  members: [
    { id: 'm1', role: 'owner', user: { id: 'u1', name: 'Fabio', email: 'fabio@test.local' } },
    { id: 'm2', role: 'member', user: { id: 'u2', name: '', email: 'erika@test.local' } },
  ],
});

const pageOf = (items: AdminOrganization[]) =>
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
    ],
  });
  return TestBed.createComponent(AdminOrganizationsPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

const rowFor = (fixture: { nativeElement: unknown }, text: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(text));

/** The chevron that opens a row is the first button in it. */
const expandButton = (row: Element | undefined) =>
  row?.querySelector('button') as HTMLButtonElement | null;

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

  it('does not fetch any members until a row is opened', async () => {
    const getOrganization = vi.fn(() => of(detailOf(ACME)));
    const fixture = setup({ listOrganizations: () => pageOf([ACME, PAID]), getOrganization });
    await fixture.whenStable();

    // Loading every row's members so that expanding feels instant is the alternative,
    // and it is one request per row on every page load.
    expect(getOrganization).not.toHaveBeenCalled();

    expandButton(rowFor(fixture, 'Acme Srl'))?.click();
    await fixture.whenStable();

    expect(getOrganization).toHaveBeenCalledWith('acme');
    expect(getOrganization).toHaveBeenCalledTimes(1);
  });

  it('shows the members of the row that was opened', async () => {
    const fixture = setup({
      listOrganizations: () => pageOf([ACME]),
      getOrganization: () => of(detailOf(ACME)),
    });
    await fixture.whenStable();

    expandButton(rowFor(fixture, 'Acme Srl'))?.click();
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Fabio');
    // Falls back to the email when the account has no name.
    expect(page(fixture).textContent).toContain('erika@test.local');
    expect(page(fixture).textContent).toContain('Owner');
  });

  it('stops asking for members once the row is closed again', async () => {
    const getOrganization = vi.fn(() => of(detailOf(ACME)));
    const fixture = setup({ listOrganizations: () => pageOf([ACME]), getOrganization });
    await fixture.whenStable();

    const button = expandButton(rowFor(fixture, 'Acme Srl'));
    button?.click();
    await fixture.whenStable();
    button?.click();
    await fixture.whenStable();

    expect(page(fixture).textContent).not.toContain('fabio@test.local');
    expect(getOrganization).toHaveBeenCalledTimes(1);
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
