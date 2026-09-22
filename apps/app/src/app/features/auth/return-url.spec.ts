import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { authGuard, AuthService, provideCore, safeReturnUrl } from '@app/core';

@Component({ selector: 'app-stub', template: '' })
class StubPage {}

function setup(authenticated: boolean) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([
        { path: 'sign-in', component: StubPage },
        { path: 'accept-invitation', canMatch: [authGuard], component: StubPage },
      ]),
      provideCore({
        apiUrl: '/api',
        authUrl: '/api/auth',
        loginRoute: '/sign-in',
        homeRoute: '/dashboard',
        defaultLocale: 'it',
        supportedLocales: ['it', 'en'],
      }),
      { provide: AuthService, useValue: { authenticated: () => authenticated } },
    ],
  });
  return TestBed.inject(Router);
}

/**
 * An invitation email is a link with the invitation id in its QUERY STRING, behind the
 * auth guard. CanMatch is handed path segments with the query already stripped, so the
 * obvious implementation loses exactly the part that identifies the invitation — and
 * the visitor signs in and lands on an empty dashboard.
 *
 * The guard reads the attempted URL from the navigation instead. That is the piece
 * that could quietly return nothing, so it is the piece under test.
 */
describe('returning to where you were going', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('carries the whole URL, query string included, to the login page', async () => {
    const router = setup(false);

    await router.navigateByUrl('/accept-invitation?id=inv_123');

    expect(router.url).toContain('/sign-in');
    // Encoded, but the id has to survive: without it the invitation is unopenable.
    expect(decodeURIComponent(router.url)).toContain('redirect=/accept-invitation?id=inv_123');
  });

  it('lets a signed-in visitor straight through, with no redirect appended', async () => {
    const router = setup(true);

    await router.navigateByUrl('/accept-invitation?id=inv_123');

    expect(router.url).toBe('/accept-invitation?id=inv_123');
  });

  it('refuses a return URL that leaves the application', () => {
    // It comes from a query string, which means it comes from whoever wrote the link.
    expect(safeReturnUrl('https://evil.example/steal')).toBeNull();
    expect(safeReturnUrl('//evil.example/steal')).toBeNull();
    expect(safeReturnUrl('/\\evil.example')).toBeNull();
    expect(safeReturnUrl('/members?tab=invites')).toBe('/members?tab=invites');
  });
});
