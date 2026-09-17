import { computed, Service, signal } from '@angular/core';
import { AppError } from '../http/app-error';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  /** i18n key, never a sentence — the host translates it. */
  messageKey: string;
  params?: Record<string, unknown>;
}

/** How long each tone stays up. An error needs longer than a confirmation to read. */
const LIFETIME_MS: Record<ToastTone, number> = {
  success: 4_000,
  info: 4_000,
  error: 8_000,
};

/**
 * Transient messages, in one place.
 *
 * It holds **keys**, not sentences, and never touches transloco — which is what keeps
 * it in `libs/core`, where the layering rules allow no dependency beyond the contracts.
 * The host component translates when it renders, so a language switch re-renders what
 * is already on screen instead of leaving a stale sentence behind.
 *
 * `error()` takes an AppError directly because that is the shape every failed call
 * already has: the interceptor normalises the envelope into one, and every page was
 * otherwise repeating the same `instanceof AppError ? … : 'errors.INTERNAL_ERROR'`.
 *
 * What does NOT belong here: anything the user must act on, and anything that explains
 * the state of the page rather than the outcome of an action. A list that failed to
 * load is not a toast — it is the page, and it has to say so where the list would be.
 *
 * Rendering is somebody else's problem: `dui-toaster` in `libs/ui` takes the list as an
 * input, the way `dui-app-shell` takes its menu. The layering forbids `libs/ui` from
 * reaching into `libs/core`, and the result is the better design anyway.
 */
@Service()
export class ToastService {
  private readonly items = signal<readonly Toast[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();

  readonly toasts = computed(() => this.items());

  success(messageKey: string, params?: Record<string, unknown>): number {
    return this.show('success', messageKey, params);
  }

  info(messageKey: string, params?: Record<string, unknown>): number {
    return this.show('info', messageKey, params);
  }

  /** Accepts the error itself, so no caller has to unwrap it again. */
  error(error: unknown, params?: Record<string, unknown>): number {
    const key =
      error instanceof AppError
        ? error.translationKey
        : typeof error === 'string'
          ? error
          : 'errors.INTERNAL_ERROR';
    return this.show('error', key, params);
  }

  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.items.update((current) => current.filter((toast) => toast.id !== id));
  }

  clear(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.items.set([]);
  }

  private show(tone: ToastTone, messageKey: string, params?: Record<string, unknown>): number {
    const id = this.nextId++;
    const toast: Toast = { id, tone, messageKey, ...(params ? { params } : {}) };

    this.items.update((current) => [...current, toast]);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), LIFETIME_MS[tone]),
    );

    return id;
  }
}
