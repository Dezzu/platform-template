import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { emailMessage, type Database } from '@app/db';
import { appConfig } from '../../config/namespaces';
import { DRIZZLE } from '../../database/database.module';
import { JOBS, QUEUES } from '../../queue/queue.constants';
import { renderHtml, renderText } from './templates/layout';
import {
  EMAIL_TEMPLATES,
  type EmailTemplateId,
  type EmailTemplateParams,
} from './templates/registry';
import { isEmailLocale, type EmailLocale, type EmailTemplate } from './templates/template.types';

export interface SendEmailInput<T extends EmailTemplateId> {
  to: string;
  template: T;
  params: EmailTemplateParams<T>;
  /** Falls back to DEFAULT_LOCALE when absent or unknown. */
  locale?: string | undefined;
  /** Null for mail that precedes any tenant — signup verification, password reset. */
  organizationId?: string | null | undefined;
  userId?: string | null | undefined;
}

/**
 * Anything whose name suggests it unlocks something. Values under these keys are
 * masked before the row is written.
 */
const SECRET_KEY = /url|token|link|code|secret|password|otp/i;

/**
 * The only way the application sends email.
 *
 * `send` does not send. It renders, records the intent in `email_message`, and
 * enqueues — and that separation is the whole design. **Never send inline from an HTTP
 * handler**: an invitation sent inline means a member who is not added because SES had
 * a bad second, and a signup that 500s because the mail server was slow. Enqueued, the
 * request succeeds and the delivery is retried.
 *
 * Rendering happens here as well as in the worker, on purpose: a template called with
 * the wrong parameters throws at the call site, where there is a stack trace pointing
 * at the caller, rather than five retries later in a worker log.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue(QUEUES.EMAIL) private readonly queue: Queue,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /** Renders, records and enqueues. Returns the `email_message` id. */
  async send<T extends EmailTemplateId>(input: SendEmailInput<T>): Promise<string> {
    const locale = this.resolveLocale(input.locale);
    // The registry is a union of differently-parameterised templates. The generic on
    // SendEmailInput already tied `params` to `template` at the call site, so this
    // function only has to run the schema and the renderer — neither of which needs to
    // know which template it got.
    const template = EMAIL_TEMPLATES[input.template] as EmailTemplate<unknown>;

    const params = template.schema.parse(input.params);
    const content = template.render[locale](params, { appName: this.app.name, locale });

    const [row] = await this.db
      .insert(emailMessage)
      .values({
        organizationId: input.organizationId ?? null,
        userId: input.userId ?? null,
        toEmail: input.to,
        template: input.template,
        locale,
        subject: content.subject,
        params: redactParams(params),
        status: 'pending',
      })
      .returning({ id: emailMessage.id });

    if (!row) throw new Error('failed to record the outgoing email');

    await this.queue.add(JOBS.EMAIL_SEND, {
      messageId: row.id,
      template: input.template,
      locale,
      to: input.to,
      params,
    });

    this.logger.debug(`queued "${input.template}" to ${input.to} (${row.id})`);
    return row.id;
  }

  /** Renders a template for a locale. Shared with the worker so the two cannot differ. */
  renderFor(
    templateId: EmailTemplateId,
    locale: EmailLocale,
    params: unknown,
  ): { subject: string; html: string; text: string } {
    const template = EMAIL_TEMPLATES[templateId] as EmailTemplate<unknown>;
    const parsed = template.schema.parse(params);
    const context = { appName: this.app.name, locale };
    const content = template.render[locale](parsed, context);

    return {
      subject: content.subject,
      html: renderHtml(content, context),
      text: renderText(content, context),
    };
  }

  private resolveLocale(locale: string | undefined): EmailLocale {
    if (locale && isEmailLocale(locale)) return locale;
    const fallback = this.app.defaultLocale;
    return isEmailLocale(fallback) ? fallback : 'en';
  }
}

/**
 * Masks secret-looking values so the stored row answers "was it sent?" without also
 * answering "what was the link?".
 */
export function redactParams(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) return {};

  return Object.fromEntries(
    Object.entries(params as Record<string, unknown>).map(([key, value]) => [
      key,
      SECRET_KEY.test(key) && typeof value === 'string' ? '[redacted]' : value,
    ]),
  );
}
