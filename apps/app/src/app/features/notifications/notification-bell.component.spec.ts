import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { NotificationBellComponent } from './notification-bell.component';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideI18n('it'),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCore({
        apiUrl: '/api',
        authUrl: '/api/auth',
        loginRoute: '/sign-in',
        homeRoute: '/dashboard',
        defaultLocale: 'it',
        supportedLocales: ['it', 'en'],
      }),
    ],
  });

  const fixture = TestBed.createComponent(NotificationBellComponent);
  fixture.detectChanges();

  const http = TestBed.inject(HttpTestingController);
  const trigger = (fixture.nativeElement as HTMLElement).querySelector('button');

  return { fixture, http, trigger: trigger! };
}

/**
 * Lets the resource start its request and Angular re-render.
 *
 * Not `whenStable()`: with the testing backend the request stays pending until it is
 * flushed, so the application never becomes stable and the test times out instead of
 * failing on the assertion — which is a worse failure because it says nothing.
 */
async function settle(fixture: { detectChanges: () => void }): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve));
  fixture.detectChanges();
}

/** How many times the panel asked the server for its list. */
function listRequests(http: HttpTestingController): number {
  const matched = http.match((request) => request.url.includes('/notifications'));
  const count = matched.length;
  for (const request of matched) {
    request.flush({ items: [], meta: { page: 0, size: 5, total: 0, totalPages: 0 } });
  }
  return count;
}

/**
 * The panel loads when the menu **opens**, not when the button is clicked.
 *
 * Those are not the same event, and treating them as the same produced a bug that was
 * only findable by using the screen: with `(click)` on the trigger there were two
 * handlers on one element — the CDK's own and ours — and after activating an item
 * inside the panel the next click on the bell was swallowed entirely. Open, click a
 * notification, come back, click the bell: nothing. Click again: fine. "Delle volte
 * non si apre."
 *
 * It also fetched on the way out, because the closing click is a click too.
 *
 * This case pins the cheap, observable half: opening asks once, closing asks nothing.
 * Reintroduce `(click)="open()"` and the second assertion fails.
 */
describe('NotificationBellComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('asks for the list when the panel opens, and not when it closes', async () => {
    const { fixture, http, trigger } = setup();

    // Nothing is fetched until it is opened: most sessions never press this.
    expect(listRequests(http)).toBe(0);

    trigger.click();
    await settle(fixture);
    expect(listRequests(http)).toBe(1);

    trigger.click();
    await settle(fixture);
    // The closing click must not send the panel looking again for a list nobody is
    // about to read.
    expect(listRequests(http)).toBe(0);
  });
});
