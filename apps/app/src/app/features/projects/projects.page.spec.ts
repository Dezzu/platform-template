import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@app/contracts';
import type { TableAction } from '@app/ui/mix';
import { AppError, PermissionsService, ToastService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { ProjectsApi } from './projects.api';
import { ProjectsPage } from './projects.page';

const project = (over: Partial<Project> & { id: string }): Project => ({
  organizationId: 'o',
  name: `Progetto ${over.id}`,
  description: null,
  status: 'active',
  createdByUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

const SITE = project({ id: '1', name: 'Sito istituzionale', description: 'Il sito pubblico' });
const OLD = project({ id: '2', name: 'Vecchio portale', status: 'archived' });

const pageOf = (items: Project[]) =>
  of({ items, meta: { page: 0, size: 10, total: items.length, totalPages: 1 } });

/**
 * Rendering this page in a test is what makes an unresolvable import a CI failure
 * rather than a 500 on a lazy chunk that only appears after signing in and clicking.
 * That happened once: `zod` was declared in packages/contracts but not at the
 * workspace root, so the dev server could not resolve it inside this route's chunk.
 */
function setup(api: Partial<ProjectsApi>, permissions: string[] = ['projects.delete']) {
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
      { provide: ProjectsApi, useValue: api },
      ToastService,
      {
        provide: PermissionsService,
        useValue: {
          anyOf: (...required: string[]) => required.some((p) => permissions.includes(p)),
          allOf: (...required: string[]) => required.every((p) => permissions.includes(p)),
        },
      },
    ],
  });
  return TestBed.createComponent(ProjectsPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

const rowFor = (fixture: { nativeElement: unknown }, name: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(name));

/** The actions live behind the three dots, in an overlay that only exists once opened. */
const internalsOf = (fixture: { componentInstance: unknown }) =>
  fixture.componentInstance as unknown as { actions: () => TableAction<Project>[] };

/** By what it is, not by where it sits: the order changes when an action is added. */
const actionNamed = (fixture: { componentInstance: unknown }, label: string) =>
  internalsOf(fixture)
    .actions()
    .find((action) => action.label === label);

describe('ProjectsPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists what the API returns, in a table', async () => {
    const fixture = setup({ list: () => pageOf([SITE, OLD]) });
    await fixture.whenStable();

    expect(page(fixture).querySelector('table')).not.toBeNull();
    expect(page(fixture).textContent).toContain('Sito istituzionale');
    expect(rowFor(fixture, 'Sito istituzionale')?.textContent).toContain('Il sito pubblico');
  });

  it('reads a status as a badge rather than as another word in a row of words', async () => {
    const fixture = setup({ list: () => pageOf([SITE, OLD]) });
    await fixture.whenStable();

    expect(rowFor(fixture, 'Vecchio portale')?.textContent).toContain('Archiviato');
    expect(rowFor(fixture, 'Sito istituzionale')?.textContent).toContain('Attivo');
  });

  it('asks the server again when the table changes page or search', async () => {
    const list = vi.fn(() => pageOf([SITE]));
    const fixture = setup({ list });
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
      pageRequest: { page: 1, size: 10, query: 'sito', sortField: 'name', sortOrder: -1 },
    });
    await fixture.whenStable();

    // Filtering in the browser would silently mean "search the rows you are looking at".
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, q: 'sito', sort: 'name', dir: 'desc' }),
    );
    // Once on init, once for the change — not twice on init.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('shows the empty state rather than a blank screen', async () => {
    const fixture = setup({ list: () => pageOf([]) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Nessun risultato');
  });

  it('says so when the request fails, instead of looking empty', async () => {
    const fixture = setup({ list: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    // A resource in an error state throws from `value()`; reading it optimistically
    // would take the render down and the message with it.
    expect(page(fixture).textContent).toContain('Si è verificato un errore');
  });

  it('leads to the form, rather than editing in place', async () => {
    const fixture = setup({ list: () => pageOf([SITE]) }, ['projects.manage']);
    await fixture.whenStable();

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    actionNamed(fixture, 'Modifica')?.command(SITE, []);

    // A form is a page in this template: the address names what you are editing, and
    // the back button does what it looks like it does.
    expect(navigate).toHaveBeenCalledWith(['/projects', '1']);
  });

  it('offers the add control only to someone who may create', async () => {
    const mayCreate = setup({ list: () => pageOf([SITE]) }, ['projects.manage']);
    await mayCreate.whenStable();
    expect(page(mayCreate).textContent).toContain('Aggiungi');

    TestBed.resetTestingModule();

    const readOnly = setup({ list: () => pageOf([SITE]) }, ['projects.read']);
    await readOnly.whenStable();
    expect(page(readOnly).textContent).not.toContain('Aggiungi');
  });

  it('hides the delete action from a user without the permission', async () => {
    const fixture = setup({ list: () => pageOf([SITE]) }, ['projects.read']);
    await fixture.whenStable();

    // A courtesy, not a control: the API refuses the call regardless, which the
    // tenant-isolation suite asserts separately.
    expect(
      internalsOf(fixture)
        .actions()
        .filter((a) => a.visible?.(SITE, []) ?? true),
    ).toEqual([]);
    expect(rowFor(fixture, 'Sito istituzionale')?.querySelector('button')).toBeNull();
  });

  it('reports the deletion, and reports a refusal just as plainly', async () => {
    const list = vi.fn(() => pageOf([SITE]));
    const fixture = setup({ list, remove: () => of(undefined) });
    await fixture.whenStable();

    actionNamed(fixture, 'Elimina')?.command(SITE, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(list).toHaveBeenCalledTimes(2);
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.messageKey),
    ).toEqual(['projects.deleted']);
  });

  it('translates a refusal from the API', async () => {
    const fixture = setup({
      list: () => pageOf([SITE]),
      remove: () => throwError(() => new AppError(403, 'FORBIDDEN', 'nope')),
    });
    await fixture.whenStable();

    actionNamed(fixture, 'Elimina')?.command(SITE, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.messageKey),
    ).toEqual(['errors.FORBIDDEN']);
  });
});
