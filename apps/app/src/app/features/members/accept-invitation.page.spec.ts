import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvitationPreview } from '@app/contracts';
import { AppError, AuthService, PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '../../../testing/alerts';
import { AcceptInvitationPage } from './accept-invitation.page';
import { MembersApi } from './members.api';

const PREVIEW: InvitationPreview = {
  id: 'inv-1',
  email: 'erika@test.local',
  role: 'member',
  status: 'pending',
  organizationName: 'Acme Srl',
  inviterName: 'fabio@test.local',
  expiresAt: '2026-12-31T00:00:00.000Z',
};

function setup(api: Partial<MembersApi>, queryParams: Record<string, string> = { id: 'inv-1' }) {
  const navigateByUrl = vi.fn(() => Promise.resolve(true));

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
      { provide: MembersApi, useValue: api },
      {
        provide: ActivatedRoute,
        useValue: {
          snapshot: { queryParamMap: { get: (key: string) => queryParams[key] ?? null } },
        },
      },
      { provide: Router, useValue: { navigateByUrl } },
      { provide: AuthService, useValue: { setActiveOrganization: vi.fn(() => Promise.resolve()) } },
      { provide: PermissionsService, useValue: { refresh: vi.fn(() => Promise.resolve(null)) } },
    ],
  });

  return { fixture: TestBed.createComponent(AcceptInvitationPage), navigateByUrl };
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

describe('AcceptInvitationPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('shows what the invitation says before anything is committed', async () => {
    const accept = vi.fn();
    const { fixture } = setup({ preview: () => of(PREVIEW), accept });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('Acme Srl');
    expect(page(fixture).textContent).toContain('erika@test.local');
    // The load must never accept on its own: a link forwarded to a colleague would
    // otherwise add the colleague the moment they opened it.
    expect(accept).not.toHaveBeenCalled();
  });

  it('joins and switches organization only when the button is pressed', async () => {
    const accept = vi.fn(() => of({ organizationId: 'org-9' }));
    const { fixture, navigateByUrl } = setup({ preview: () => of(PREVIEW), accept });
    await fixture.whenStable();

    const button = page(fixture).querySelector('button') as HTMLButtonElement;
    button.click();
    await fixture.whenStable();

    expect(accept).toHaveBeenCalledWith('inv-1');
    expect(navigateByUrl).toHaveBeenCalledWith('/dashboard');
  });

  it('explains an invitation it cannot read, rather than showing an empty card', async () => {
    const { fixture } = setup({
      preview: () => throwError(() => new AppError(403, 'FORBIDDEN', 'not yours')),
    });
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('non è disponibile');
  });

  it('says so when the link carries no id', async () => {
    const { fixture } = setup({ preview: () => of(PREVIEW) }, {});
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('incompleto');
  });
});
