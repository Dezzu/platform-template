import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CORE_CONFIG } from '../config/core.config';
import { NotificationCenterService } from './notification-center.service';
import { ToastService } from './toast.service';

function setup() {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      {
        provide: CORE_CONFIG,
        useValue: {
          apiUrl: '/api',
          authUrl: '/api/auth',
          loginRoute: '/sign-in',
          homeRoute: '/dashboard',
          defaultLocale: 'it',
          supportedLocales: ['it', 'en'],
        },
      },
    ],
  });

  const centre = TestBed.inject(NotificationCenterService);
  const toasts = TestBed.inject(ToastService);

  /**
   * `announce` is private and the listener that calls it cannot be driven here: the
   * test environment has no `EventSource`, which is exactly why `connect()` refuses to
   * run in it. Reaching the method directly is the only way to cover the branch, and
   * the branch is worth covering — it is what the user actually sees.
   */
  const announce = (data: unknown) =>
    (centre as unknown as { announce: (event: Event) => void }).announce(
      new MessageEvent('notification', {
        data: typeof data === 'string' ? data : JSON.stringify(data),
      }),
    );

  return { centre, toasts, announce };
}

/**
 * The toast is what makes a notification *noticed*; the badge is what makes it survive
 * being missed. These cases are about the first half — and about the payload being
 * untrusted input, because it arrives over a channel shared by every API process,
 * including ones running an older or newer release.
 */
describe('NotificationCenterService arrivals', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('raises a toast carrying the key and its parameters', () => {
    const { toasts, announce } = setup();

    announce({
      type: 'member.joined',
      titleKey: 'notifications.types.member.joined.title',
      params: { memberName: 'Erika' },
    });

    const shown = toasts.toasts();
    expect(shown).toHaveLength(1);
    // The key, never a sentence: the toaster translates when it renders, so a language
    // switch re-renders a toast that is still on screen.
    expect(shown[0]?.messageKey).toBe('notifications.types.member.joined.title');
    expect(shown[0]?.params).toEqual({ memberName: 'Erika' });
    expect(shown[0]?.tone).toBe('info');
  });

  it('copes with a notification that has no parameters', () => {
    const { toasts, announce } = setup();

    announce({ type: 'x', titleKey: 'notifications.types.x.title', params: null });

    expect(toasts.toasts()).toHaveLength(1);
    expect(toasts.toasts()[0]?.params).toBeUndefined();
  });

  it('says nothing when the payload is not what this release understands', () => {
    const { toasts, announce } = setup();

    // An older or newer process on the same channel, or plain rubbish. The count has
    // already been refreshed by the caller, so the badge still moves — losing the
    // announcement is the whole cost, and it beats showing a raw key on screen.
    announce('not json at all');
    announce({ type: 'x' });
    announce({ type: 'x', titleKey: 42 });

    expect(toasts.toasts()).toHaveLength(0);
  });
});
