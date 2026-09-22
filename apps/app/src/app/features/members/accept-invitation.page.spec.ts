import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvitationPreview } from '@app/contracts';
import { AppError, AuthService, PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '@app/ui/testing';
import { AcceptInvitationPage } from './accept-invitation.page';
import { MembersApi } from './members.api';

const PREVIEW: InvitationPreview = {
  id: 'inv-1',
  email: 'erika@test.local',
  role: 'member',
  status: 'pending',
  organizationName: 'Acme Srl',
  inviterName: 'fabio@test.local',
  expiresAt: '2099-12-31T00:00:00.000Z',
  accountExists: false,
};

interface Session {
  authenticated: boolean;
  email?: string;
}

function setup(
  api: Partial<MembersApi>,
  session: Session = { authenticated: false },
  queryParams: Record<string, string> = { id: 'inv-1' },
  auth: Partial<Record<string, unknown>> = {},
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
      { provide: MembersApi, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: { get: (key: string) => queryParams[key] ?? null } },
        },
      },
      {
        provide: AuthService,
        useValue: {
          authenticated: () => session.authenticated,
          user: () => (session.email ? { id: 'u1', email: session.email } : null),
          setActiveOrganization: vi.fn(() => Promise.resolve()),
          signUp: vi.fn(() => Promise.resolve({})),
          signOut: vi.fn(() => Promise.resolve()),
          ...auth,
        },
      },
      { provide: PermissionsService, useValue: { refresh: vi.fn(() => Promise.resolve(null)) } },
    ],
  });

  /**
   * The real Router with `navigateByUrl` spied on, rather than a stub: the template
   * uses routerLink, which reads more of it than a plausible stub provides — and these
   * cases are about *where* it goes, not about the navigation happening.
   */
  const navigateByUrl = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);

  return { fixture: TestBed.createComponent(AcceptInvitationPage), navigateByUrl };
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

/**
 * This page is the one an invitation email lands on, and it is public: the person it
 * is for usually has no account, so its job is to let them make one. It used to sit
 * behind the auth guard, which turned an invitation into a login form the recipient
 * could not satisfy — the four cases below are the four ways somebody can arrive.
 */
describe('AcceptInvitationPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('offers to set a password when the invited address has no account', async () => {
    const accept = vi.fn();
    const { fixture } = setup({ preview: () => of(PREVIEW), accept });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Acme Srl');
    expect(page(fixture).textContent).toContain('erika@test.local');
    expect(page(fixture).querySelector('input[type="password"]')).not.toBeNull();
    // The load must never accept on its own: a link forwarded to a colleague would
    // otherwise add the colleague the moment they opened it.
    expect(accept).not.toHaveBeenCalled();
  });

  it('creates the account for the invited address and joins, in one press', async () => {
    const accept = vi.fn(() => of({ organizationId: 'org-9' }));
    const signUp = vi.fn(() => Promise.resolve({}));
    const { fixture, navigateByUrl } = setup(
      { preview: () => of(PREVIEW), accept },
      // Authenticated after the sign-up call, which is what the real service does.
      { authenticated: true, email: 'erika@test.local' },
      { id: 'inv-1' },
      { signUp },
    );
    await fixture.whenStable();

    const internals = fixture.componentInstance as unknown as {
      model: { set: (v: { name: string; password: string }) => void };
      register: (event: Event) => Promise<void>;
    };
    internals.model.set({ name: 'Erika', password: 'a-long-enough-password' });
    await internals.register(new Event('submit'));

    // The address is never typed: the account being created is the one invited.
    expect(signUp).toHaveBeenCalledWith('erika@test.local', 'a-long-enough-password', 'Erika');
    expect(accept).toHaveBeenCalledWith('inv-1');
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('sends somebody who already has an account to sign in, carrying the invitation', async () => {
    const { fixture } = setup({ preview: () => of({ ...PREVIEW, accountExists: true }) });
    await fixture.whenStable();

    expect(page(fixture).querySelector('input[type="password"]')).toBeNull();
    const link = page(fixture).querySelector('a[href*="sign-in"]') as HTMLAnchorElement | null;
    expect(link?.getAttribute('href')).toContain('redirect');
    expect(decodeURIComponent(link?.getAttribute('href') ?? '')).toContain('id=inv-1');
  });

  it('joins on an explicit press when the right person is already signed in', async () => {
    const accept = vi.fn(() => of({ organizationId: 'org-9' }));
    const { fixture, navigateByUrl } = setup(
      { preview: () => of(PREVIEW), accept },
      {
        authenticated: true,
        email: 'erika@test.local',
      },
    );
    await fixture.whenStable();

    (page(fixture).querySelector('button') as HTMLButtonElement).click();
    await fixture.whenStable();

    expect(accept).toHaveBeenCalledWith('inv-1');
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('says so when somebody else is signed in, instead of letting the accept fail', async () => {
    const accept = vi.fn();
    const { fixture } = setup(
      { preview: () => of(PREVIEW), accept },
      {
        authenticated: true,
        email: 'someone.else@test.local',
      },
    );
    await fixture.whenStable();

    // The usual cause is a shared computer, and the way out is attached.
    expect(pageAlerts(fixture)).toContain('un altro account');
    expect(page(fixture).textContent).toContain('erika@test.local');
  });

  it('explains an invitation it cannot read, rather than showing an empty card', async () => {
    const { fixture } = setup({
      preview: () => throwError(() => new AppError(404, 'INVITATION_NOT_FOUND', 'gone')),
    });
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('non è disponibile');
  });

  it('says so when the link carries no id', async () => {
    const { fixture } = setup({ preview: () => of(PREVIEW) }, { authenticated: false }, {});
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('incompleto');
  });
});
