import { z } from 'zod';
import { PageQuerySchema } from '../../common/pagination';

/**
 * Notifications: what the product tells you happened, and where.
 *
 * The registry below is shared rather than living on the backend, because both sides
 * need it for different halves of the same question: the API decides whether to write
 * and send, the preferences screen has to enumerate the switches. Two copies would
 * drift into a screen offering a toggle for something nothing sends.
 */

export const NOTIFICATION_CHANNELS = ['in_app', 'email'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_TYPES = ['member.joined', 'billing.payment_failed'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * What a type is, and what happens when nobody has said otherwise.
 *
 * `defaults` is consulted whenever there is no `notification_preference` row — which
 * is the normal case. It is what lets a new type ship switched on without writing a
 * row per user per channel, and what lets the default be reconsidered later without a
 * migration.
 *
 * `mandatory` marks a channel the reader may not switch off. Use it sparingly and
 * never for anything promotional: it exists for the handful of messages whose absence
 * is itself the damage — a payment that failed and will take the product away in three
 * days is not a preference.
 */
export interface NotificationTypeDefinition {
  type: NotificationType;
  /** i18n keys, resolved by whoever renders. Never sentences. */
  titleKey: string;
  bodyKey: string;
  /** For the preferences screen, which groups by what the notification is about. */
  group: 'organization' | 'billing';
  defaults: Record<NotificationChannel, boolean>;
  mandatory?: readonly NotificationChannel[];
}

export const NOTIFICATION_REGISTRY: Record<NotificationType, NotificationTypeDefinition> = {
  'member.joined': {
    type: 'member.joined',
    titleKey: 'notifications.types.member.joined.title',
    bodyKey: 'notifications.types.member.joined.body',
    group: 'organization',
    // On in the centre, off by email: somebody accepting an invitation you sent is
    // worth knowing and not worth an interruption.
    defaults: { in_app: true, email: false },
  },
  'billing.payment_failed': {
    type: 'billing.payment_failed',
    titleKey: 'notifications.types.billing.payment_failed.title',
    bodyKey: 'notifications.types.billing.payment_failed.body',
    group: 'billing',
    defaults: { in_app: true, email: true },
    /**
     * Not switchable. A renewal that failed removes the product in a matter of days,
     * and the one person who would turn this off is the one who most needs to see it.
     */
    mandatory: ['email'],
  },
};

export function isNotificationType(value: string): value is NotificationType {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_REGISTRY, value);
}

/**
 * Whether a channel is on, given what the reader chose and what the registry says.
 *
 * The single place this question is answered — the API calls it before sending, the
 * preferences screen calls it to show the switch. A second implementation would be a
 * screen that disagrees with what actually arrives.
 */
export function notificationEnabled(
  type: NotificationType,
  channel: NotificationChannel,
  chosen: boolean | undefined,
): boolean {
  const definition = NOTIFICATION_REGISTRY[type];
  if (definition.mandatory?.includes(channel)) return true;
  return chosen ?? definition.defaults[channel];
}

export const NotificationSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  titleKey: z.string(),
  bodyKey: z.string(),
  params: z.record(z.string(), z.unknown()).nullable(),
  /** An in-app route, or null when there is nowhere useful to go. */
  actionUrl: z.string().nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListQuerySchema = PageQuerySchema.extend({
  /** Only what has not been read yet — what the bell opens on. */
  unread: z.stringbool().optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const UnreadCountSchema = z.object({ unread: z.number().int().nonnegative() });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

/** One switch, as the reader sees it. `chosen` is null while they never decided. */
export const NotificationPreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  /**
   * What the notification is about, for grouping the screen.
   *
   * Sent rather than derived in the browser from the type prefix: the registry
   * declares it, and a client that split the string would disagree the first time a
   * type is named something the prefix does not describe.
   */
  group: z.enum(['organization', 'billing']),
  /** The effective answer — defaults and mandatory already applied. */
  enabled: z.boolean(),
  /** False when the registry forbids changing it. */
  editable: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

export const NotificationPreferenceUpdateSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  channel: z.enum(NOTIFICATION_CHANNELS),
  enabled: z.boolean(),
});
export type NotificationPreferenceUpdate = z.infer<typeof NotificationPreferenceUpdateSchema>;
