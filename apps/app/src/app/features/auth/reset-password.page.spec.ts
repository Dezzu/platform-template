import { provideZonelessChangeDetection } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { pageAlerts } from '../../../testing/alerts';
import { ResetPasswordPage } from './reset-password.page';

function setup(token: string | null, resetPassword = vi.fn(() => Promise.resolve({}))) {
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
      { provide: AuthService, useValue: { resetPassword } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: { get: () => token } } },
      },
      { provide: Router, useValue: { navigateByUrl } },
    ],
  });

  return { fixture: TestBed.createComponent(ResetPasswordPage), navigateByUrl, resetPassword };
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

/** Types into a `dui-password-input` the way the user would. */
function fill(fixture: { nativeElement: unknown }, index: number, value: string): void {
  const input = [...page(fixture).querySelectorAll('input')][index] as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('ResetPasswordPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('shows no form at all without a token', async () => {
    const { fixture } = setup(null);
    await fixture.whenStable();

    expect(page(fixture).querySelector('form')).toBeNull();
    expect(pageAlerts(fixture)).toContain('incompleto');
  });

  it('refuses to submit when the two fields disagree', async () => {
    const { fixture, resetPassword } = setup('tok-1');
    await fixture.whenStable();

    fill(fixture, 0, 'a-long-enough-password');
    fill(fixture, 1, 'a-different-password-1');
    await fixture.whenStable();

    page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(resetPassword).not.toHaveBeenCalled();
    expect(pageAlerts(fixture)).toContain('non coincidono');
  });

  it('sends the token with the new password, then lands on sign-in', async () => {
    const { fixture, navigateByUrl, resetPassword } = setup('tok-1');
    await fixture.whenStable();

    fill(fixture, 0, 'a-long-enough-password');
    fill(fixture, 1, 'a-long-enough-password');
    await fixture.whenStable();

    page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
    await fixture.whenStable();

    expect(resetPassword).toHaveBeenCalledWith('tok-1', 'a-long-enough-password');
    // Signing in again is what proves to the user that the new password works.
    expect(navigateByUrl).toHaveBeenCalledWith('/sign-in');
  });

  it('explains a link that has already been used', async () => {
    const { fixture } = setup(
      'tok-old',
      vi.fn(() => Promise.resolve({ error: 'INVALID_TOKEN' })),
    );
    await fixture.whenStable();

    fill(fixture, 0, 'a-long-enough-password');
    fill(fixture, 1, 'a-long-enough-password');
    await fixture.whenStable();

    page(fixture).querySelector('form')?.dispatchEvent(new Event('submit'));
    // Two settles: the first lets the submit handler's promise resolve, the second
    // renders what it set.
    await fixture.whenStable();
    await fixture.whenStable();

    expect(pageAlerts(fixture)).toContain('non è più valido');
  });
});
