import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
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
import { AppException } from '../../common';
import { DRIZZLE } from '../../database/database.module';
import type { OrgContext } from '../../auth/org-context';
import { MailService } from '../mail/mail.service';
import { NotificationsRepository } from './notifications.repository';
import { EMAIL_FOR_TYPE, type NotificationEmail } from './notification-email.map';

type NotificationRow = typeof notification.$inferSelect;

/** What a feature hands over when something worth telling somebody about happened. */
export interface NotifyInput {
  organizationId: string;
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

  // ── Reading ────────────────────────────────────────────────────────────────

  async list(scope: OrgContext, query: NotificationListQuery): Promise<Paginated<Notification>> {
    // Always this person's own. The scope covers the tenant; this covers the reader,
    // and without it every member of an organization would read everyone's mail.
    const mine = eq(notification.userId, scope.userId);
    const unreadOnly = and(mine, isNull(notification.readAt));
    // Composed so the type stays a plain SQL: `and()` widens to `SQL | undefined`, and
    // `exactOptionalPropertyTypes` refuses to pass that as an optional `where`.
    const where = query.unread && unreadOnly ? unreadOnly : mine;

    const [rows, total] = await Promise.all([
      this.repository.findMany(scope, {
        where,
        orderBy: desc(notification.createdAt),
        limit: query.size,
        offset: query.page * query.size,
      }),
      this.repository.count(scope, where),
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
    const [row] = await this.db
      .select({ value: count() })
      .from(notification)
      .where(
        and(
          eq(notification.organizationId, scope.organizationId),
          eq(notification.userId, scope.userId),
          isNull(notification.readAt),
        ),
      );
    return row?.value ?? 0;
  }

  async markRead(scope: OrgContext, id: string): Promise<Notification> {
    const row = await this.repository.findById(scope, id);
    // Somebody else's notification is indistinguishable from a missing one, which is
    // deliberate: a 403 would confirm that the id exists.
    if (!row || row.userId !== scope.userId) throw AppException.notFound('Notification');

    // Idempotent: reading something twice does not move the moment it was first read.
    if (row.readAt) return toDto(row);

    const [updated] = await this.db
      .update(notification)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(eq(notification.id, id))
      .returning();

    return toDto(updated ?? row);
  }

  /** Marks everything this person has unread in this tenant. Returns how many. */
  async markAllRead(scope: OrgContext): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(notification)
      .set({ readAt: now, updatedAt: now })
      .where(
        and(
          eq(notification.organizationId, scope.organizationId),
          eq(notification.userId, scope.userId),
          isNull(notification.readAt),
        ),
      )
      .returning({ id: notification.id });

    return updated.length;
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
