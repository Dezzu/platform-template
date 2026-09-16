import { provideZonelessChangeDetection, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService, PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { SignInPage } from './sign-in.page';
import { SignUpPage } from './sign-up.page';

/**
 * Guards a failure mode that is invisible in review and catastrophic in production.
 *
 * `(ngSubmit)` is an output of NgForm, which only exists when FormsModule is imported.
 * These pages use Signal Forms, so the binding attached to nothing, the browser
 * performed its own GET submit, and the credentials landed in the URL:
 *
 *   /sign-in?ng.form0.email=…&ng.form0.password=…
 *
 * From there a password reaches browser history, Referer headers and access logs.
 * Angular cannot catch it — an unknown event binding on an element is legal — and
 * neither can the type system. Only submitting the form does.
 */
const PAGES: readonly [string, Type<unknown>][] = [
  ['sign-in', SignInPage],
  ['sign-up', SignUpPage],
];

describe.each(PAGES)('%s form submission', (_name, Page) => {
  beforeEach(() => {
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
        // Stubbed so the test exercises the form, not the network.
        {
          provide: AuthService,
          useValue: {
            signInWithPassword: async () => ({}),
            signUp: async () => ({}),
            signInWithGoogle: async () => undefined,
          },
        },
        { provide: PermissionsService, useValue: { refresh: async () => null } },
      ],
    });
  });

  it('prevents the browser from submitting natively, which would put the password in the URL', async () => {
    const fixture = TestBed.createComponent(Page);
    await fixture.whenStable();

    const form = (fixture.nativeElement as HTMLElement).querySelector('form');
    expect(form, 'the page must render a form').not.toBeNull();

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form!.dispatchEvent(event);

    expect(
      event.defaultPrevented,
      'submit must be prevented — otherwise the browser navigates and the credentials end up in the query string',
    ).toBe(true);
  });

  it('has a submit button, so Enter in a field triggers the handler', async () => {
    const fixture = TestBed.createComponent(Page);
    await fixture.whenStable();

    const button = (fixture.nativeElement as HTMLElement).querySelector('button[type="submit"]');
    expect(button).not.toBeNull();
  });
});
