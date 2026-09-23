import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';
import { Subject, type Observable } from 'rxjs';
import { z } from 'zod';
import { queueConfig, redisConfig } from '../../config/namespaces';

/**
 * What one raised notification looks like on the wire between API processes.
 *
 * Deliberately thin. It carries who it is for and enough to decide whether a given
 * connection cares — never the body, never the parameters. The browser refetches what
 * it needs, which keeps this message safe to put on a channel every API process is
 * listening to and keeps one shape from having to match the read model forever.
 */
export const NotificationEventSchema = z.object({
  userIds: z.array(z.string()).min(1),
  /** Null when the notification is about the person rather than about a tenant. */
  organizationId: z.string().nullable(),
  type: z.string(),
  raisedAt: z.iso.datetime(),
});
export type NotificationEvent = z.infer<typeof NotificationEventSchema>;

/**
 * Carries "something was raised" from the process that wrote it to the process holding
 * the browser's connection.
 *
 * **Pub/sub, not a queue — and the difference is the whole point.** A BullMQ queue
 * delivers each job to exactly one consumer: that is what makes it right for sending
 * an email, and wrong for this. An SSE connection lives on one process, and with two
 * API containers the notification is written by whichever one served the POST while
 * the connection hangs off whichever one the proxy picked — so a queue would hand the
 * event to the right process about half the time, and the badge would move for some
 * people and not others with nothing in the logs to explain it. Pub/sub fans the
 * message out to every subscriber; each one keeps what its own connections asked for
 * and drops the rest.
 *
 * Two connections, because that is how Redis works: a client in subscriber mode may
 * not issue ordinary commands, so publishing needs its own.
 *
 * Delivery is at-most-once and that is accepted. A missed event costs a badge that
 * stays stale until the next one, or until the page is opened again — and the
 * alternative, persisting a per-connection backlog, is a mailbox to garbage-collect in
 * exchange for a number that is usually zero.
 */
@Injectable()
export class NotificationBus implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationBus.name);

  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly channel: string;

  private readonly events = new Subject<NotificationEvent>();

  /** Everything this process has heard, from any process including itself. */
  readonly stream: Observable<NotificationEvent> = this.events.asObservable();

  constructor(
    @Inject(redisConfig.KEY) redis: ConfigType<typeof redisConfig>,
    @Inject(queueConfig.KEY) queue: ConfigType<typeof queueConfig>,
  ) {
    // Prefixed like the queues, for the same reason: the Valkey instance is shared
    // with other stacks, and an unprefixed channel name is somebody else's too.
    this.channel = `${queue.prefix}:notifications`;

    this.publisher = new Redis(redis.url, { maxRetriesPerRequest: null, lazyConnect: true });
    this.subscriber = new Redis(redis.url, { maxRetriesPerRequest: null, lazyConnect: true });

    // Losing the bus must never take the API down with it: the product works without
    // live badges, it does not work without a process.
    for (const client of [this.publisher, this.subscriber]) {
      client.on('error', (error) => this.logger.warn(`notification bus: ${error.message}`));
    }
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
      await this.subscriber.subscribe(this.channel);

      this.subscriber.on('message', (_channel, raw) => this.receive(raw));
      this.logger.log(`listening on "${this.channel}"`);
    } catch (error: unknown) {
      this.logger.error(
        `could not join the notification bus — badges will not move on their own`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Announces a notification to every process.
   *
   * Never throws at the caller. The rows are already written and the email is already
   * queued by the time this runs; failing the request because the live update did not
   * go out would trade something that matters for something that does not.
   */
  async publish(event: NotificationEvent): Promise<void> {
    try {
      await this.publisher.publish(this.channel, JSON.stringify(event));
    } catch (error: unknown) {
      this.logger.warn(`failed to announce '${event.type}': ${String(error)}`);
    }
  }

  /**
   * A message off the channel is untrusted input, exactly like a job payload.
   *
   * Anything on a shared Valkey can write to this channel, and an older or newer
   * release certainly will during a rolling deploy. A message that does not parse is
   * dropped with a line in the log rather than pushed at a browser.
   */
  private receive(raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('discarded a notification event that was not JSON');
      return;
    }

    const result = NotificationEventSchema.safeParse(parsed);
    if (!result.success) {
      this.logger.warn(`discarded a malformed notification event: ${result.error.message}`);
      return;
    }

    this.events.next(result.data);
  }

  async onModuleDestroy(): Promise<void> {
    this.events.complete();
    // `quit` rather than `disconnect`: it lets the in-flight unsubscribe finish, which
    // is what keeps a restart from leaving a subscriber attached on the server side.
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }
}
