import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@app/contracts';
import { AppError, ToastService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { ProjectsApi } from './projects.api';
import { ProjectFormPage } from './project-form.page';

const EXISTING: Project = {
  id: 'p1',
  organizationId: 'o',
  name: 'Sito istituzionale',
  description: 'Il sito pubblico',
  status: 'archived',
  createdByUserId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

let navigateByUrl: ReturnType<typeof vi.spyOn>;

function setup(api: Partial<ProjectsApi>, id: string | null = null) {
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
        // The id comes from the URL, so the cases that need one put it there.
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: { get: () => id } } },
      },
    ],
  });

  navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return TestBed.createComponent(ProjectFormPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

const inputs = (fixture: { nativeElement: unknown }) => ({
  name: page(fixture).querySelector('input') as HTMLInputElement,
  description: page(fixture).querySelector('textarea') as HTMLTextAreaElement,
});

function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  element.value = value;
  element.dispatchEvent(new Event('input'));
}

const raised = () =>
  TestBed.inject(ToastService)
    .toasts()
    .map(({ tone, messageKey }) => ({ tone, messageKey }));

describe('ProjectFormPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  describe('creating', () => {
    it('opens empty, and does not ask the server for anything', async () => {
      const getById = vi.fn();
      const fixture = setup({ getById });
      await fixture.whenStable();

      expect(getById).not.toHaveBeenCalled();
      expect(inputs(fixture).name.value).toBe('');
      expect(page(fixture).textContent).toContain('Nuovo progetto');
    });

    it('refuses to submit without a name', async () => {
      const create = vi.fn(() => of(EXISTING));
      const fixture = setup({ create });
      await fixture.whenStable();

      page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
      await fixture.whenStable();

      expect(create).not.toHaveBeenCalled();
    });

    it('sends what was typed, then leaves for the list', async () => {
      const create = vi.fn(() => of(EXISTING));
      const fixture = setup({ create });
      await fixture.whenStable();

      type(inputs(fixture).name, '  Nuovo sito  ');
      type(inputs(fixture).description, '');
      await fixture.whenStable();

      page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();

      // Trimmed, and an empty description is null rather than '' — the contract takes
      // null to mean "no description", and '' would store a blank one.
      expect(create).toHaveBeenCalledWith({
        name: 'Nuovo sito',
        description: null,
        status: 'active',
      });
      expect(raised()).toEqual([{ tone: 'success', messageKey: 'projects.created' }]);
      expect(navigateByUrl).toHaveBeenCalledWith('/projects');
    });
  });

  describe('editing', () => {
    it('fills the form with the project it was asked for', async () => {
      const fixture = setup({ getById: () => of(EXISTING) }, 'p1');
      await fixture.whenStable();

      expect(page(fixture).textContent).toContain('Modifica progetto');
      expect(inputs(fixture).name.value).toBe('Sito istituzionale');
      expect(inputs(fixture).description.value).toBe('Il sito pubblico');
    });

    it('updates rather than creating', async () => {
      const update = vi.fn(() => of(EXISTING));
      const fixture = setup({ getById: () => of(EXISTING), update }, 'p1');
      await fixture.whenStable();

      type(inputs(fixture).name, 'Sito rinnovato');
      await fixture.whenStable();

      page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await fixture.whenStable();

      expect(update).toHaveBeenCalledWith('p1', {
        name: 'Sito rinnovato',
        description: 'Il sito pubblico',
        status: 'archived',
      });
      expect(raised()).toEqual([{ tone: 'success', messageKey: 'projects.saved' }]);
    });

    it('says so when the project is not there, instead of an empty form', async () => {
      const fixture = setup(
        { getById: () => throwError(() => new AppError(404, 'NOT_FOUND', 'gone')) },
        'missing',
      );
      await fixture.whenStable();

      expect(page(fixture).querySelector('form')).toBeNull();
      expect(page(fixture).querySelector('[role="alert"]')?.textContent).toContain('non trovato');
    });
  });

  it('stays on the page when the save is refused, so the work is not lost', async () => {
    const fixture = setup({
      create: () => throwError(() => new AppError(409, 'CONFLICT', 'duplicate')),
    });
    await fixture.whenStable();

    type(inputs(fixture).name, 'Doppione');
    await fixture.whenStable();

    page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(raised()).toEqual([{ tone: 'error', messageKey: 'errors.CONFLICT' }]);
    // And what was typed is still there to be corrected.
    expect(inputs(fixture).name.value).toBe('Doppione');
  });
});
