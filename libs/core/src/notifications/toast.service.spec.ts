import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../http/app-error';
import { ToastService } from './toast.service';

describe('ToastService', () => {
  let toasts: ToastService;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ToastService] });
    toasts = TestBed.inject(ToastService);
  });

  afterEach(() => vi.useRealTimers());

  it('holds the key, not the sentence', () => {
    toasts.success('admin.resetLinkQueued', { email: 'erika@demo.it' });

    // Translating here would freeze the wording of a message that is still on screen
    // when the language changes.
    expect(toasts.toasts()).toEqual([
      {
        id: 1,
        tone: 'success',
        messageKey: 'admin.resetLinkQueued',
        params: { email: 'erika@demo.it' },
      },
    ]);
  });

  it('unwraps an AppError into its translation key', () => {
    toasts.error(new AppError(403, 'CANNOT_GRANT_HIGHER_ROLE', 'nope'));

    expect(toasts.toasts()[0]?.messageKey).toBe('errors.CANNOT_GRANT_HIGHER_ROLE');
    expect(toasts.toasts()[0]?.tone).toBe('error');
  });

  it('falls back for anything that is not an AppError', () => {
    toasts.error(new TypeError('undefined is not a function'));

    // A stack trace is not a message to a user.
    expect(toasts.toasts()[0]?.messageKey).toBe('errors.INTERNAL_ERROR');
  });

  it('accepts a key directly, for the cases that have no error object', () => {
    toasts.error('errors.NETWORK_ERROR');

    expect(toasts.toasts()[0]?.messageKey).toBe('errors.NETWORK_ERROR');
  });

  it('leaves an error up longer than a confirmation', () => {
    toasts.success('a');
    toasts.error('b');

    vi.advanceTimersByTime(4_000);
    expect(toasts.toasts().map((toast) => toast.messageKey)).toEqual(['b']);

    vi.advanceTimersByTime(4_000);
    expect(toasts.toasts()).toEqual([]);
  });

  it('stacks rather than replacing, so a second outcome does not hide the first', () => {
    toasts.success('a');
    toasts.success('b');

    expect(toasts.toasts()).toHaveLength(2);
  });

  it('forgets the timer of a toast dismissed by hand', () => {
    const id = toasts.success('a');
    toasts.dismiss(id);
    expect(toasts.toasts()).toEqual([]);

    // Without clearing it the timer would still fire, and a later toast that happened
    // to reuse the id would vanish early.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(toasts.toasts()).toEqual([]);
  });
});
