import type { EmailTemplate } from './template.types';
import { emailVerificationTemplate } from './email-verification.template';
import { memberJoinedTemplate } from './member-joined.template';
import { paymentFailedTemplate } from './payment-failed.template';
import { organizationInvitationTemplate } from './organization-invitation.template';
import { passwordResetTemplate } from './password-reset.template';
import { gdprExportReadyTemplate } from './gdpr-export-ready.template';
import { accountDeletionScheduledTemplate } from './account-deletion-scheduled.template';

/**
 * Every email the product can send.
 *
 * A registry rather than a directory scan: the template id is persisted in
 * `email_message` and referenced from job payloads, so the set has to be closed and
 * known at compile time. Adding one here is what makes `mail.send({ template: 'x' })`
 * type-check, and its parameters type-check with it.
 *
 * The keys are written as literals rather than taken from each template's `id`,
 * because a computed key widens to `string` and the whole type-safety of the call site
 * goes with it. A spec asserts that key and `id` agree.
 */
export const EMAIL_TEMPLATES = {
  'email-verification': emailVerificationTemplate,
  'password-reset': passwordResetTemplate,
  'organization-invitation': organizationInvitationTemplate,
  // The email half of the notification types that can reach somebody that way. One
  // template per type, rather than one generic template fed rendered text: the i18n
  // catalogue lives in the browser, and a backend that pre-rendered sentences would
  // freeze the reader's language at the moment the event happened.
  'member-joined': memberJoinedTemplate,
  'payment-failed': paymentFailedTemplate,
  // Privacy. Neither carries a link to anything but a screen: see the comment in
  // gdpr-export-ready.template.ts on why an archive link must never sit in an inbox.
  'gdpr-export-ready': gdprExportReadyTemplate,
  'account-deletion-scheduled': accountDeletionScheduledTemplate,
} as const;

export type EmailTemplateId = keyof typeof EMAIL_TEMPLATES;

/** The parameter type of one template, so the call site cannot pass the wrong shape. */
export type EmailTemplateParams<T extends EmailTemplateId> =
  (typeof EMAIL_TEMPLATES)[T] extends EmailTemplate<infer P> ? P : never;

export function isEmailTemplateId(value: string): value is EmailTemplateId {
  return Object.prototype.hasOwnProperty.call(EMAIL_TEMPLATES, value);
}
