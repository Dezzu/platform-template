import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { ProjectsApi } from './projects.api';
import { ProjectsPage } from './projects.page';

/**
 * Rendering this page in a test is what makes an unresolvable import a CI failure
 * rather than a 500 on a lazy chunk that only appears after signing in and clicking.
 * That happened once: `zod` was declared in packages/contracts but not at the
 * workspace root, so the dev server could not resolve it inside this route's chunk.
 */
function setup(api: Partial<ProjectsApi>, permissions: string[] = []) {
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
      { provide: ProjectsApi, useValue: api },
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

describe('ProjectsPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists what the API returns', async () => {
    const fixture = setup({
      list: () =>
        of({
          items: [
            {
              id: '1',
              organizationId: 'o',
              name: 'Sito istituzionale',
              description: null,
              status: 'active' as const,
              createdByUserId: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          meta: { page: 0, size: 50, total: 1, totalPages: 1 },
        }),
    });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Sito istituzionale');
  });

  it('shows the empty state rather than a blank screen', async () => {
    const fixture = setup({
      list: () => of({ items: [], meta: { page: 0, size: 50, total: 0, totalPages: 0 } }),
    });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Nessun risultato');
  });

  it('says so when the request fails, instead of looking empty', async () => {
    const fixture = setup({ list: () => throwError(() => new Error('boom')) });
    await fixture.whenStable();

    expect(page(fixture).querySelector('[role="alert"]')).not.toBeNull();
  });

  it('hides the delete control from a user without the permission', async () => {
    const fixture = setup(
      {
        list: () =>
          of({
            items: [
              {
                id: '1',
                organizationId: 'o',
                name: 'Sito',
                description: null,
                status: 'active' as const,
                createdByUserId: null,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            meta: { page: 0, size: 50, total: 1, totalPages: 1 },
          }),
      },
      ['projects.read'],
    );
    await fixture.whenStable();

    // A courtesy, not a control: the API refuses the call regardless, which the
    // tenant-isolation suite asserts separately.
    expect(page(fixture).querySelector('button[variant="destructive"]')).toBeNull();
  });
});
