import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEntry } from '@app/contracts';
import { provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { AuditApi } from './audit.api';
import { AuditPage } from './audit.page';

const entry = (over: Partial<AuditEntry> & { id: string }): AuditEntry => ({
  action: 'project.created',
  createdAt: '2026-09-22T10:30:00.000Z',
  actorUserId: 'u1',
  actorEmail: 'fabio@demo.it',
  actorName: 'Fabio',
  impersonatorUserId: null,
  impersonatorEmail: null,
  resourceType: 'project',
  resourceId: 'p1',
  before: null,
  after: { name: 'Sito' },
  ip: '127.0.0.1',
  userAgent: 'Firefox',
  requestId: 'req-1',
  traceId: null,
  ...over,
});

const CREATED = entry({ id: 'a1' });
const BY_SUPPORT = entry({
  id: 'a2',
  action: 'member.removed',
  impersonatorUserId: 'admin-1',
  impersonatorEmail: 'support@demo.it',
});

const pageOf = (items: AuditEntry[]) =>
  of({ items, meta: { page: 0, size: 10, total: items.length, totalPages: 1 } });

function setup(api: Partial<AuditApi>) {
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
      { provide: AuditApi, useValue: { facets: () => of({ actions: [] }), ...api } },
    ],
  });
  return TestBed.createComponent(AuditPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

const rowFor = (fixture: { nativeElement: unknown }, text: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(text));

const expandButton = (row: Element | undefined) =>
  row?.querySelector('button') as HTMLButtonElement | null;

describe('AuditPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('reads an action as a sentence, not as a machine key', async () => {
    const fixture = setup({ list: () => pageOf([CREATED]) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Progetto creato');
    expect(page(fixture).textContent).not.toContain('project.created');
  });

  it('falls back to the raw action when nothing has translated it yet', async () => {
    const unknownAction = entry({ id: 'a3', action: 'invoice.voided' });
    const fixture = setup({ list: () => pageOf([unknownAction]) });
    await fixture.whenStable();

    // The vocabulary is open — every feature adds to it — so a missing translation has
    // to degrade to something a reader can act on, not to `audit.actions.invoice.voided`.
    expect(page(fixture).textContent).toContain('invoice.voided');
    expect(page(fixture).textContent).not.toContain('audit.actions');
  });

  it('says when somebody acted as somebody else', async () => {
    const fixture = setup({ list: () => pageOf([BY_SUPPORT]) });
    await fixture.whenStable();

    // An entry that reads as the customer's own doing, when it was support, is the one
    // thing this trail must never allow — so it goes in the row, not behind a chevron.
    expect(rowFor(fixture, 'Fabio')?.textContent).toContain('support@demo.it');
  });

  it('offers no way to change anything', async () => {
    const fixture = setup({ list: () => pageOf([CREATED]) });
    await fixture.whenStable();

    const row = rowFor(fixture, 'Progetto creato');
    // Only the expand chevron: a trail with an edit button is not a trail.
    expect(row?.querySelectorAll('button')).toHaveLength(1);
  });

  it('keeps the change itself behind the chevron', async () => {
    const fixture = setup({ list: () => pageOf([CREATED]) });
    await fixture.whenStable();

    // A diff per row is a table nobody can scan.
    expect(page(fixture).textContent).not.toContain('req-1');

    expandButton(rowFor(fixture, 'Progetto creato'))?.click();
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Sito');
    expect(page(fixture).textContent).toContain('req-1');
  });

  it('offers only the actions this trail actually contains', async () => {
    const fixture = setup({
      list: () => pageOf([CREATED]),
      facets: () => of({ actions: ['project.created', 'file.uploaded'] }),
    });
    await fixture.whenStable();

    const options = [...page(fixture).querySelectorAll('select option')].map((o) =>
      o.getAttribute('value'),
    );
    // A hard-coded list would offer filters that match nothing and miss the ones that do.
    expect(options).toEqual(['', 'project.created', 'file.uploaded']);
  });

  it('asks the server again when the filter changes, from the first page', async () => {
    const list = vi.fn(() => pageOf([CREATED]));
    const fixture = setup({ list, facets: () => of({ actions: ['file.uploaded'] }) });
    await fixture.whenStable();

    const select = page(fixture).querySelector('select') as HTMLSelectElement;
    select.value = 'file.uploaded';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();

    // Back to page 0: staying on page 4 of the old result set shows an empty table.
    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'file.uploaded', page: 0 }),
    );
  });

  it('says so when the trail cannot be read, instead of looking empty', async () => {
    const fixture = setup({ list: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Si è verificato un errore');
  });
});
