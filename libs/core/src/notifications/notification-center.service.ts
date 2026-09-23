import { computed, inject, PLATFORM_ID, Service, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { CORE_CONFIG } from '../config/core.config';
import { NotificationsApi } from '../api/notifications.api';

/** How long to wait before reconnecting, and how far that backs off. */
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * How many notifications are waiting — the number on the bell — kept live.
 *
 * Named for the centre rather than "notifications" because this library already has a
 * `ToastService`, and the two are different things: a toast is the outcome of what you
 * just did and disappears, a notification is something that happened while you were
 * elsewhere and waits.
 *
 * **It was not live, and that was the bug.** The count was read once when the shell
 * was built and nothing moved it afterwards, so a notification raised while somebody
 * was looking at the page showed up only after a reload — and if the badge had been at
 * zero it simply never appeared, which reads as a broken bell rather than as a stale
 * number.
 *
 * Now the server pushes. `connect()` opens an `EventSource` against
 * `/notifications/stream`, and each event is a **nudge**: the count is refetched
 * rather than carried in the message. That keeps the number authoritative — it comes
 * from the same query the page would run — and keeps the stream from quietly becoming
 * a second read model that can disagree with the first.
 *
 * Still no polling. The one timer here is the reconnect backoff, and it only runs
 * while the connection is actually down.
 */
@Service()
export class NotificationCenterService {
  private readonly api = inject(NotificationsApi);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly apiUrl = inject(CORE_CONFIG).apiUrl;

  private readonly state = signal(0);

  readonly unread = computed(() => this.state());
  readonly hasUnread = computed(() => this.state() > 0);

  /**
   * Bumped whenever the server says something arrived.
   *
   * The bell panel watches it so an open panel refreshes itself instead of showing a
   * list that no longer matches the number above it.
   */
  private readonly arrivals = signal(0);
  readonly arrived = computed(() => this.arrivals());

  private source: EventSource | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryDelay = RETRY_BASE_MS;

  async refresh(): Promise<void> {
    try {
      const { unread } = await firstValueFrom(this.api.unreadCount());
      this.state.set(unread);
    } catch {
      // A failed count is not worth a message: the bell simply shows nothing, and the
      // notifications page reports its own failure when opened.
      this.state.set(0);
    }
  }

  /**
   * Opens the live connection, and keeps it open.
   *
   * Idempotent: the shell calls it on every construction, and a second call while a
   * connection is healthy must not open a second stream — each one costs a held
   * request on the server for as long as the tab is up.
   */
  connect(): void {
    // No EventSource under prerendering, and nothing to listen to either: the server
    // has no session to stream for.
    if (!this.isBrowser || this.source) return;

    /**
     * A capability check, not a platform one — and it earns its keep.
     *
     * `isPlatformBrowser` is true in the component test environment, which has no
     * `EventSource`, so this used to throw from the shell's constructor and take the
     * whole screen down with it. The same is true of a webview that does not implement
     * it. Without the stream the badge simply behaves as it did before — read once,
     * then still — which is a degradation, not a failure.
     */
    if (typeof EventSource === 'undefined') return;

    const source = new EventSource(`${this.apiUrl}/notifications/stream`, {
      // The session is an httpOnly cookie, and this is the only way EventSource sends
      // one — it cannot set headers, which is also why the endpoint takes no token.
      withCredentials: true,
    });
    this.source = source;

    source.addEventListener('open', () => {
      // A connection that came back may have missed events while it was down, so the
      // count is re-read rather than assumed unchanged.
      this.retryDelay = RETRY_BASE_MS;
      void this.refresh();
    });

    source.addEventListener('notification', () => {
      this.arrivals.update((value) => value + 1);
      void this.refresh();
    });

    /**
     * `EventSource` reconnects on its own — but only for a clean disconnect, and it
     * does it as fast as the server will let it. A 401 after the session expires would
     * otherwise become a tight loop against an endpoint that will keep saying no, so
     * the connection is closed here and reopened on a backoff instead.
     */
    source.addEventListener('error', () => {
      this.teardown();
      this.scheduleReconnect();
    });
  }

  /** Closes the connection. The shell calls it on destroy; signing out calls it too. */
  disconnect(): void {
    this.teardown();
    if (this.retryTimer !== undefined) {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private teardown(): void {
    this.source?.close();
    this.source = undefined;
  }

  private scheduleReconnect(): void {
    if (this.retryTimer !== undefined) return;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.connect();
    }, this.retryDelay);

    // Doubling up to a minute: a server that is down stays down for a while, and a
    // hundred tabs retrying every two seconds is a denial of service of one's own
    // making.
    this.retryDelay = Math.min(this.retryDelay * 2, RETRY_MAX_MS);
  }

  /** Applied locally after marking things read, so the badge does not lag a request. */
  set(unread: number): void {
    this.state.set(Math.max(0, unread));
  }

  decrement(): void {
    this.state.update((current) => Math.max(0, current - 1));
  }

  clear(): void {
    this.state.set(0);
  }
}
