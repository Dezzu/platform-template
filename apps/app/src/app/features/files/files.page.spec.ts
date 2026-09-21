import { DOCUMENT, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileMetadata, FileUploadTicket } from '@app/contracts';
import { AppError, PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { FilesApi } from './files.api';
import { FilesPage } from './files.page';

const READY: FileMetadata = {
  id: 'f1',
  organizationId: 'o',
  objectKey: 'o/2026/03/uuid-relazione.pdf',
  fileName: 'relazione.pdf',
  contentType: 'application/pdf',
  size: 2_097_152,
  status: 'ready',
  uploadedByUserId: 'u1',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
};

const listOf = (items: FileMetadata[]) =>
  of({
    items,
    meta: { page: 0, size: 50, total: items.length, totalPages: items.length > 0 ? 1 : 0 },
  });

function setup(api: Partial<FilesApi>, permissions: string[] = ['files.read', 'files.write']) {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideI18n('it'),
      provideCore({
        apiUrl: '/api',
        authUrl: '/api/auth',
        loginRoute: '/sign-in',
        homeRoute: '/dashboard',
        defaultLocale: 'it',
        supportedLocales: ['it', 'en'],
      }),
      { provide: FilesApi, useValue: api },
      // The real document with only `location` intercepted: Angular reads plenty of
      // the rest of it, and a bare stand-in takes the whole TestBed down. Stubbing
      // `window.location` directly is not reliably possible in jsdom.
      { provide: DOCUMENT, useValue: documentWithFakeLocation() },
      {
        provide: PermissionsService,
        useValue: {
          anyOf: (...required: string[]) => required.some((p) => permissions.includes(p)),
          allOf: (...required: string[]) => required.every((p) => permissions.includes(p)),
        },
      },
    ],
  });
  return TestBed.createComponent(FilesPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

/** Where the browser was told to go. Reset before each case. */
const location = { href: '' };

function documentWithFakeLocation(): Document {
  return new Proxy(document, {
    get(target, property) {
      if (property === 'location') return location;
      const value = Reflect.get(target, property) as unknown;
      // Bound, or a DOM method called through the proxy raises "Illegal invocation".
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Document;
}

/** Fires a change event carrying a file, the way the browser does. */
function selectFile(fixture: { nativeElement: unknown }, file: File): Promise<void> {
  const input = page(fixture).querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  return Promise.resolve();
}

describe('FilesPage', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    location.href = '';
  });

  it('lists what the API returns, with a readable size', async () => {
    const fixture = setup({ list: () => listOf([READY]) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('relazione.pdf');
    expect(page(fixture).textContent).toContain('2.0 MB');
  });

  it('shows the empty state rather than a blank screen', async () => {
    const fixture = setup({ list: () => listOf([]) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Nessun file caricato.');
  });

  it('says so when the list fails, instead of looking empty', async () => {
    const fixture = setup({ list: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    expect(page(fixture).querySelector('[role="alert"]')).not.toBeNull();
  });

  it('runs ticket → upload → commit in that order, then reloads', async () => {
    const calls: string[] = [];
    const ticket = {
      file: { ...READY, id: 'f-new', status: 'pending' },
      uploadUrl: 'http://storage.local/bucket/key?sig=1',
      requiredHeaders: { 'Content-Type': 'application/pdf' },
      expiresAt: '2026-03-01T00:15:00.000Z',
    } as FileUploadTicket;

    const fixture = setup({
      list: () => {
        calls.push('list');
        return listOf([]);
      },
      requestTicket: () => {
        calls.push('ticket');
        return of(ticket);
      },
      upload: async () => {
        calls.push('upload');
      },
      commit: () => {
        calls.push('commit');
        return of(READY);
      },
    });
    await fixture.whenStable();

    await selectFile(fixture, new File(['x'], 'relazione.pdf', { type: 'application/pdf' }));
    await fixture.whenStable();

    // The order is the protocol: committing before the bytes land marks a file ready
    // that is not there.
    expect(calls).toEqual(['list', 'ticket', 'upload', 'commit', 'list']);
  });

  it('translates a refusal from the API instead of failing silently', async () => {
    const fixture = setup({
      list: () => listOf([]),
      requestTicket: () =>
        throwError(() => new AppError(413, 'FILE_TOO_LARGE', 'File exceeds the limit')),
    });
    await fixture.whenStable();

    await selectFile(fixture, new File(['x'], 'huge.pdf', { type: 'application/pdf' }));
    await fixture.whenStable();

    expect(page(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'supera la dimensione massima',
    );
  });

  it('sends the browser to the presigned URL, without opening a window', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);

    const fixture = setup({
      list: () => listOf([READY]),
      downloadUrl: () =>
        of({ downloadUrl: 'http://storage.local/key?sig=2', expiresAt: READY.updatedAt }),
    });
    await fixture.whenStable();

    (page(fixture).querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await fixture.whenStable();

    // The presigned GET carries Content-Disposition: attachment, so the download
    // starts and the page stays put. No tab, and therefore no popup blocker.
    expect(location.href).toBe('http://storage.local/key?sig=2');
    expect(open).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('leaves the page alone when the URL never arrives', async () => {
    const fixture = setup({
      list: () => listOf([READY]),
      downloadUrl: () => throwError(() => new AppError(409, 'FILE_NOT_READY', 'not ready')),
    });
    await fixture.whenStable();

    (page(fixture).querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(location.href).toBe('');
    expect(page(fixture).querySelector('[role="alert"]')).not.toBeNull();
  });

  it('hides the upload control from a user who may only read', async () => {
    const fixture = setup({ list: () => listOf([READY]) }, ['files.read']);
    await fixture.whenStable();

    expect(page(fixture).querySelector('input[type="file"]')).toBeNull();
  });
});
