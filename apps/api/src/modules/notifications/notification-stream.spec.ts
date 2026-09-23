import { Subject, type Subscription } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { MessageEvent } from '@nestjs/common';
import type { Database } from '@app/db';
import type { NotificationBus, NotificationEvent } from './notification-bus.service';
import type { NotificationsRepository } from './notifications.repository';
import { NotificationsService } from './notifications.service';
import type { MailService } from '../mail/mail.service';

/**
 * Who a live event reaches.
 *
 * This is the security boundary of the stream and it is worth a test of its own: the
 * bus fans every event out to **every** API process, so each process holds events for
 * people who are not connected to it. What keeps one browser from seeing another's is
 * the filter in `streamFor` and nothing else — there is no tenant predicate underneath
 * it the way there is on the read path, because there is no query.
 *
 * The service is built by hand rather than through the testing module: `streamFor`
 * touches only the bus, and booting Nest to prove a filter would be slower and would
 * hide which collaborator actually matters.
 */
describe('NotificationsService.streamFor', () => {
  const ME = 'user-me';
  const MY_ORG = 'org-mine';

  let subscription: Subscription | undefined;

  afterEach(() => subscription?.unsubscribe());

  function listen(organizationId: string | null = MY_ORG): {
    publish: (event: Partial<NotificationEvent>) => void;
    received: MessageEvent[];
  } {
    const channel = new Subject<NotificationEvent>();
    const bus = { stream: channel.asObservable() } as NotificationBus;

    const service = new NotificationsService(
      {} as NotificationsRepository,
      bus,
      {} as MailService,
      {} as Database,
    );

    const received: MessageEvent[] = [];
    subscription = service.streamFor(ME, organizationId).subscribe((event) => received.push(event));

    return {
      received,
      publish: (event) =>
        channel.next({
          userIds: [ME],
          organizationId: MY_ORG,
          type: 'member.joined',
          titleKey: 'notifications.types.member.joined.title',
          params: null,
          raisedAt: new Date().toISOString(),
          ...event,
        }),
    };
  }

  it('forwards an event addressed to me in the tenant I am working in', () => {
    const { publish, received } = listen();
    publish({});
    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe('notification');
  });

  it('drops an event addressed to somebody else', () => {
    const { publish, received } = listen();
    // The event is on this process's bus because every process gets every event. That
    // is exactly the case where a missing filter leaks one person's mail to another.
    publish({ userIds: ['user-somebody-else'] });
    expect(received).toHaveLength(0);
  });

  it('drops an event raised in a tenant I am not working in', () => {
    const { publish, received } = listen();
    // It is genuinely mine — the same account in another organization — and it still
    // must not move a badge that does not count it.
    publish({ organizationId: 'org-other' });
    expect(received).toHaveLength(0);
  });

  it('forwards an event that belongs to no tenant, whichever one I am in', () => {
    const { publish, received } = listen();
    // "La copia dei tuoi dati è pronta": a fact about the person, so it follows them.
    publish({ organizationId: null, type: 'gdpr.export_ready' });
    expect(received).toHaveLength(1);
  });

  it('forwards a tenant-less event even to somebody working in no tenant at all', () => {
    const { publish, received } = listen(null);
    publish({ organizationId: null });
    expect(received).toHaveLength(1);
  });

  it('carries the key and its parameters, so a toast can be raised at once', () => {
    const { publish, received } = listen();
    publish({
      type: 'gdpr.export_ready',
      titleKey: 'notifications.types.gdpr.export_ready.title',
      params: { scope: 'user' },
    });

    /**
     * The key, never a sentence — the reader can change language, and text frozen at
     * publish time would stay in whichever one was active then. And nothing more than
     * this: the body and the count are still refetched, so the stream cannot drift
     * into a second read model.
     */
    expect(received[0]?.data).toEqual({
      type: 'gdpr.export_ready',
      titleKey: 'notifications.types.gdpr.export_ready.title',
      params: { scope: 'user' },
    });
  });
});
