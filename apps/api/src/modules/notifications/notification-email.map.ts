import type { NotificationType } from '@app/contracts';
import type { EmailTemplateId, EmailTemplateParams } from '../mail/templates/registry';

/**
 * Which email template carries which notification type.
 *
 * A type with no entry simply never reaches anybody by email, whatever the preference
 * says — which is the safe direction: a switch nobody can satisfy is a switch that
 * does nothing, not an email that fails to render in a worker.
 */
export const EMAIL_FOR_TYPE = {
  'member.joined': 'member-joined',
  'billing.payment_failed': 'payment-failed',
} as const satisfies Partial<Record<NotificationType, EmailTemplateId>>;

/**
 * The parameters any of those templates might need.
 *
 * A union rather than a generic on `notify()`: the caller already knows which type it
 * is raising, and threading the template's parameter type through the notification API
 * would make every call site spell out a type argument to gain nothing the schema does
 * not already check when the email is rendered.
 */
export type NotificationEmail =
  EmailTemplateParams<'member-joined'> | EmailTemplateParams<'payment-failed'>;
