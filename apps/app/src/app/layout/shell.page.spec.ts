import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AuthService,
  NAV_SECTIONS,
  PermissionsService,
  ToastService,
  provideCore,
} from '@app/core';
import type { ShellNavSection } from '@app/ui/layout';
import { provideI18n } from '@app/i18n';
import { ShellPage } from './shell.page';

function setup(
  permissions: string[] = [],
  platform: string[] = [],
  mode = 'b2b',
  impersonating = false,
  maintenance: { enabled: boolean; messageKey: string | null } | null = null,
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
      {
        provide: AuthService,
        useValue: {
          user: () => ({ id: 'u1', name: 'Fabio', email: 'fabio@demo.it' }),
          // Leaving an impersonation is a session operation now, not an
          // administrative one — the shell no longer knows the admin area exists.
          stopImpersonating: () => Promise.resolve(),
        },
      },
      ToastService,
      {
        provide: PermissionsService,
        useValue: {
          anyOf: (...required: string[]) => required.some((p) => permissions.includes(p)),
          allOf: (...required: string[]) => required.every((p) => permissions.includes(p)),
          anyOfPlatform: (...required: string[]) => required.some((p) => platform.includes(p)),
          mode: () => mode,
          impersonating: () => impersonating,
          maintenance: () => maintenance,
          hasPlatform: (p: string) => platform.includes(p),
        },
      },
    ],
  });
  return TestBed.createComponent(ShellPage);
}

/** `visibleSections` is protected; the grouping rules are what these cases are about. */
const sectionsOf = (fixture: { componentInstance: unknown }): ShellNavSection[] =>
  (
    fixture.componentInstance as unknown as { visibleSections: () => ShellNavSection[] }
  ).visibleSections();

describe('ShellPage menu grouping', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();

    // jsdom has no matchMedia, and the spartan sidebar asks for it on construction.
    // Stubbed rather than avoided: these cases are about the grouping the shell is
    // handed, and getting there means building the real shell.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  });

  it('puts the entries that belong to no section above every heading', () => {
    const sections = sectionsOf(setup());

    expect(sections[0]?.labelKey).toBeUndefined();
    expect(sections[0]?.items.map((item) => item.id)).toEqual(['dashboard']);
  });

  it('follows the order NAV_SECTIONS declares, not the order permissions arrive in', () => {
    const sections = sectionsOf(
      setup(['projects.read', 'members.read', 'billing.read'], ['platform.users.read']),
    );

    expect(sections.map((section) => section.id)).toEqual([
      'main',
      ...NAV_SECTIONS.map((section) => section.id),
    ]);
  });

  it('drops a section entirely when nothing in it is visible', () => {
    const sections = sectionsOf(setup(['projects.read']));

    // Not an empty block under a heading: a plain member must not see "Piattaforma"
    // above a gap, which is what filtering items without filtering headings produces.
    expect(sections.map((section) => section.id)).toEqual(['main', 'workspace']);
    expect(sections.find((section) => section.id === 'platform')).toBeUndefined();
  });

  it('says nothing about impersonation when nobody is impersonating', async () => {
    const fixture = setup();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'Stai usando l’applicazione come',
    );
  });

  it('warns permanently while impersonating, and offers the way out', async () => {
    const fixture = setup([], [], 'b2b', true);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // Not dismissible, and it names who you currently are: an administrator who
    // forgets does damage in that person's name.
    expect(text).toContain('fabio@demo.it');
    expect(text).toContain('Torna al tuo account');
  });

  it('says nothing about maintenance while the product is open', async () => {
    const fixture = setup();
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(
      'chiuso per manutenzione',
    );
  });

  it('warns whoever was let through that everybody else is seeing a notice', async () => {
    const fixture = setup([], ['platform.maintenance.manage'], 'b2b', false, {
      enabled: true,
      messageKey: 'maintenance.upgrading',
    });
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // The notice itself is a key, translated here like anywhere else.
    expect(text).toContain('chiuso per manutenzione');
    expect(text).toContain('Stiamo aggiornando il sistema');
  });

  it('drops the entries that do not belong to this kind of product', () => {
    const b2b = sectionsOf(setup(['members.read', 'billing.read'], [], 'b2b'));
    const organizationInB2b = b2b.find((section) => section.id === 'organization');
    expect(organizationInB2b?.items.map((item) => item.id)).toEqual(['members', 'billing']);

    TestBed.resetTestingModule();

    // In a personal product there is nobody to invite: the organization exists to
    // isolate data, and its membership is plumbing the user never sees.
    const b2c = sectionsOf(setup(['members.read', 'billing.read'], [], 'b2c'));
    const organizationInB2c = b2c.find((section) => section.id === 'organization');
    expect(organizationInB2c?.items.map((item) => item.id)).toEqual(['billing']);
  });

  it('keeps each entry under the section its manifest entry declares', () => {
    const sections = sectionsOf(
      setup(['projects.read', 'files.read', 'members.read', 'billing.read'], []),
    );

    const byId = new Map(sections.map((section) => [section.id, section.items.map((i) => i.id)]));
    // insights is gated on projects.read as well, hence three.
    expect(byId.get('workspace')).toEqual(['projects', 'files', 'insights']);
    expect(byId.get('organization')).toEqual(['members', 'billing']);
  });
});
