import { Inject, Injectable, Logger, type MessageEvent } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_REGISTRY,
  NOTIFICATION_TYPES,
  notificationEnabled,
  type Notification,
  type NotificationListQuery,
  type NotificationPreference,
  type NotificationPreferenceUpdate,
  type NotificationType,
  type Paginated,
} from '@app/contracts';
import {
  member,
  notification,
  notificationPreference,
  organization,
  user,
  type Database,
  type DbOrTx,
} from '@app/db';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import { AppException } from '../../common';
import { DRIZZLE } from '../../database/database.module';
import type { OrgContext } from '../../auth/org-context';
import { MailService } from '../mail/mail.service';
import { NotificationBus } from './notification-bus.service';
import { NotificationsRepository } from './notifications.repository';
import { EMAIL_FOR_TYPE, type NotificationEmail } from './notification-email.map';

type NotificationRow = typeof notification.$inferSelect;

/** What a feature hands over when something worth telling somebody about happened. */
export interface NotifyInput {
  /**
   * The tenant this happened in, or null when it did not happen in one.
   *
   * Null is for facts about the **person**: an export they asked for, an account
   * change. Those must be visible whichever organization they are working in, and
   * visible at all to somebody who belongs to none.
   */
  organizationId: string | null;
  /** The recipients. Resolving "who" is the caller's job — it knows what it means. */
  userIds: readonly string[];
  type: NotificationType;
  /** Placeholders for the registry's i18n keys. Never a rendered sentence. */
  params?: Record<string, unknown>;
  /** In-app route to open. */
  actionUrl?: string | null;
  /** Parameters for the email template, when this type has one. */
  email?: NotificationEmail | undefined;
}

/**
 * Notifications, both halves: writing them and reading them.
 *
 * **What is deliberately absent is a queue.** `notify()` inserts the in-app rows in a
 * single statement and hands each email to MailService, which only records and
 * enqueues — so no HTTP handler ever waits on a mail server, which is the property
 * that mattered. Adding a `notifications` queue would buy something only once a single
 * event fans out to hundreds of people; today the largest fan-out is "the admins of
 * one organization". When that changes, the place to change it is this method, and
 * nothing that calls it has to know.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly bus: NotificationBus,
    private readonly mail: MailService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /**
   * Tells the given people that something happened, on whichever channels each of them
   * has left on.
   *
   * Never throws at the caller: a notification is a side effect of somebody else's
   * operation, and failing to deliver one must not roll back the thing it was about.
   * Pass `tx` only when you genuinely want the opposite — that the in-app rows live or
   * die with the change they describe.
   */
  async notify(input: NotifyInput, tx?: DbOrTx): Promise<void> {
    if (input.userIds.length === 0) return;

    try {
      const definition = NOTIFICATION_REGISTRY[input.type];
      const chosen = await this.chosenFor(input.userIds, input.type, tx);

      const wantsInApp = input.userIds.filter((id) =>
        notificationEnabled(input.type, 'in_app', chosen.get(`${id}:in_app`)),
      );
      const wantsEmail = input.userIds.filter((id) =>
        notificationEnabled(input.type, 'email', chosen.get(`${id}:email`)),
      );

      if (wantsInApp.length > 0) {
        // One statement for the whole fan-out rather than a loop of inserts.
        await (tx ?? this.db).insert(notification).values(
          wantsInApp.map((userId) => ({
            organizationId: input.organizationId,
            userId,
            type: input.type,
            titleKey: definition.titleKey,
            bodyKey: definition.bodyKey,
            params: input.params ?? null,
            actionUrl: input.actionUrl ?? null,
          })),
        );
      }

      const emailTemplate = EMAIL_FOR_TYPE[input.type];
      if (emailTemplate && input.email && wantsEmail.length > 0) {
        await this.sendEmails(wantsEmail, input, emailTemplate);
      }

      /**
       * Last, and only for the people who actually got an in-app row.
       *
       * Announced after the write, never before: a browser told to refetch before the
       * INSERT has landed asks the server a question whose answer is still "nothing"
       * and then believes it. Announcing for somebody who switched the in-app channel
       * off would be just as wrong — their badge cannot move, so telling their other
       * tabs to go and look is a request that can only come back unchanged.
       */
      if (wantsInApp.length > 0) {
        await this.bus.publish({
          userIds: wantsInApp,
          organizationId: input.organizationId,
          type: input.type,
          // The same key the row was written with, not the registry's current one: an
          // event and the row it announces must say the same thing.
          titleKey: definition.titleKey,
          params: input.params ?? null,
          raisedAt: new Date().toISOString(),
        });
      }
    } catch (error: unknown) {
      // Outside a transaction a failed notification must not fail the user's request:
      // losing the message is bad, refusing the operation because of it is worse.
      if (tx) throw error;
      this.logger.error(
        `failed to deliver notification '${input.type}'`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async sendEmails(
    userIds: readonly string[],
    input: NotifyInput,
    template: NonNullable<(typeof EMAIL_FOR_TYPE)[NotificationType]>,
  ): Promise<void> {
    const recipients = await this.db
      .select({ id: user.id, email: user.email })
      .from(user)
      .where(inArray(user.id, [...userIds]));

    for (const recipient of recipients) {
      await this.mail.send({
        to: recipient.email,
        template,
        // Typed by the map: a template and the parameters it needs travel together.
        params: input.email as never,
        organizationId: input.organizationId,
        userId: recipient.id,
      });
    }
  }

  /** The explicit choices of several people for one type, keyed `userId:channel`. */
  private async chosenFor(
    userIds: readonly string[],
    type: NotificationType,
    tx?: DbOrTx,
  ): Promise<Map<string, boolean>> {
    const rows = await (tx ?? this.db)
      .select()
      .from(notificationPreference)
      .where(
        and(
          inArray(notificationPreference.userId, [...userIds]),
          eq(notificationPreference.type, type),
        ),
      );

    return new Map(rows.map((row) => [`${row.userId}:${row.channel}`, row.enabled]));
  }

  // ── The live connection ────────────────────────────────────────────────────

  /**
   * The events one browser should hear, as an Observable the SSE handler returns.
   *
   * Two filters, and the first is the security one: every process receives every
   * event, so what makes a connection see only its own is `userIds.includes` right
   * here. The second mirrors what the reader would see if they asked — a notification
   * raised in another tenant must not move a badge that does not count it.
   *
   * What goes over the wire is the least that lets the browser act: the type, the i18n
   * key and its parameters — enough to raise a toast immediately — and nothing else.
   * The count is still refetched rather than carried, so the number stays a query
   * against the same predicate the page uses and this stream never becomes a second,
   * divergent read model.
   */
  streamFor(userId: string, organizationId: string | null): Observable<MessageEvent> {
    const events = this.bus.stream.pipe(
      filter((event) => event.userIds.includes(userId)),
      filter((event) => event.organizationId === null || event.organizationId === organizationId),
      map((event): MessageEvent => ({
        type: 'notification',
        data: { type: event.type, titleKey: event.titleKey, params: event.params },
      })),
    );

    /**
     * A comment every 25 seconds, and it is not optional.
     *
     * Nginx closes an idle upstream connection after 60 by default, Cloudflare after
     * 100, and a connection that dies silently is one `EventSource` reconnects from —
     * repeatedly, which turns a live badge into a reconnect loop nobody sees. The
     * first tick also flushes the response headers, so the browser knows it is
     * connected before anything has happened.
     */
    const heartbeat = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));

    return merge(events, heartbeat);
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  async list(scope: OrgContext, query: NotificationListQuery): Promise<Paginated<Notification>> {
    // Recipient and tenant are both applied by the repository's `visibleTo`; this only
    // adds the filter the screen asked for.
    const unreadOnly = query.unread ? isNull(notification.readAt) : undefined;

    const [rows, total] = await Promise.all([
      this.repository.findMany(scope, {
        ...(unreadOnly ? { where: unreadOnly } : {}),
        orderBy: desc(notification.createdAt),
        limit: query.size,
        offset: query.page * query.size,
      }),
      this.repository.count(scope, unreadOnly),
    ]);

    return {
      items: rows.map(toDto),
      meta: {
        page: query.page,
        size: query.size,
        total,
        totalPages: Math.ceil(total / query.size),
      },
    };
  }

  async unreadCount(scope: OrgContext): Promise<number> {
    return this.repository.count(scope, isNull(notification.readAt));
  }

  async markRead(scope: OrgContext, id: string): Promise<Notification> {
    const row = await this.repository.findById(scope, id);
    // Somebody else's notification is indistinguishable from a missing one, which is
    // deliberate: a 403 would confirm that the id exists.
    if (!row) throw AppException.notFound('Notification');

    // Idempotent: the update is a no-op on an already-read row, and the row we already
    // hold is what gets returned.
    return toDto((await this.repository.markRead(scope, id)) ?? row);
  }

  /** Marks everything this person has unread here. Returns how many. */
  async markAllRead(scope: OrgContext): Promise<number> {
    return this.repository.markAllRead(scope);
  }

  // ── Preferences ────────────────────────────────────────────────────────────

  /**
   * Every switch, with the effective answer already worked out.
   *
   * The full matrix rather than the stored rows: a missing row means "never decided",
   * and a screen that only showed what was stored would start empty and imply that
   * everything is off.
   */
  async preferences(userId: string): Promise<NotificationPreference[]> {
    const rows = await this.db
      .select()
      .from(notificationPreference)
      .where(eq(notificationPreference.userId, userId));

    const chosen = new Map(rows.map((row) => [`${row.type}:${row.channel}`, row.enabled]));

    return NOTIFICATION_TYPES.flatMap((type) =>
      NOTIFICATION_CHANNELS.map((channel) => ({
        type,
        channel,
        group: NOTIFICATION_REGISTRY[type].group,
        enabled: notificationEnabled(type, channel, chosen.get(`${type}:${channel}`)),
        editable: !NOTIFICATION_REGISTRY[type].mandatory?.includes(channel),
      })),
    );
  }

  async setPreference(
    userId: string,
    input: NotificationPreferenceUpdate,
  ): Promise<NotificationPreference[]> {
    const definition = NOTIFICATION_REGISTRY[input.type];

    // Refused rather than silently ignored: a switch that accepts the click and
    // changes nothing is worse than one that says no.
    if (definition.mandatory?.includes(input.channel)) {
      throw AppException.forbidden(
        `The '${input.channel}' channel for '${input.type}' cannot be switched off`,
      );
    }

    await this.db
      .insert(notificationPreference)
      .values({ userId, type: input.type, channel: input.channel, enabled: input.enabled })
      .onConflictDoUpdate({
        target: [
          notificationPreference.userId,
          notificationPreference.type,
          notificationPreference.channel,
        ],
        set: { enabled: input.enabled, updatedAt: new Date() },
      });

    return this.preferences(userId);
  }

  /**
   * The members of an organization in any of the given roles.
   *
   * By role rather than by permission because that is what the membership table
   * stores; the caller picks the roles whose permission set covers the message —
   * `['owner', 'admin']` for anything about the tenant itself.
   */
  async recipientsInRoles(organizationId: string, roles: readonly string[]): Promise<string[]> {
    if (roles.length === 0) return [];

    const rows = await this.db
      .select({ userId: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), inArray(member.role, [...roles])));

    return rows.map((row) => row.userId);
  }

  /** The organization's display name, for an email that has to say where it is from. */
  async organizationName(organizationId: string): Promise<string> {
    const [row] = await this.db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);
    return row?.name ?? '';
  }
}

function toDto(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    titleKey: row.titleKey,
    bodyKey: row.bodyKey,
    params: row.params ?? null,
    actionUrl: row.actionUrl,
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
