import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import { emailMessage, type Database } from '@app/db';
import { mailConfig, queueConfig } from '../../config/namespaces';
import { DRIZZLE } from '../../database/database.module';
import { QUEUES } from '../../queue/queue.constants';
import { QueueWorkerHost } from '../../queue/queue-worker.host';
import { EmailJobSchema } from './mail.job';
import { MailService } from './mail.service';
import { isEmailTemplateId } from './templates/registry';
import { isEmailLocale } from './templates/template.types';
import { MAIL_TRANSPORT, type MailTransport } from './transports/mail-transport';

/**
 * Where email is actually sent.
 *
 * `autorun: false` — the base class starts the worker only when QUEUE_RUN_WORKERS says
 * so, which is what lets the same image run as an API container that only produces.
 */
@Injectable()
@Processor(QUEUES.EMAIL, { autorun: false })
export class MailProcessor extends QueueWorkerHost {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(mailConfig.KEY) private readonly config: ConfigType<typeof mailConfig>,
    @Inject(queueConfig.KEY) queue: ConfigType<typeof queueConfig>,
    private readonly mail: MailService,
  ) {
    super(QUEUES.EMAIL, { runWorkers: queue.runWorkers, concurrency: queue.concurrency });
  }

  async process(job: Job): Promise<void> {
    const payload = this.parse(EmailJobSchema, job.data);

    // A template or locale that no longer exists will not start existing on retry.
    if (!isEmailTemplateId(payload.template)) {
      throw new UnrecoverableError(`unknown email template "${payload.template}"`);
    }
    if (!isEmailLocale(payload.locale)) {
      throw new UnrecoverableError(`unsupported email locale "${payload.locale}"`);
    }

    const attempt = job.attemptsMade + 1;
    const rendered = this.mail.renderFor(payload.template, payload.locale, payload.params);

    try {
      const sent = await this.transport.send({
        to: payload.to,
        from: this.config.from,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      });

      await this.db
        .update(emailMessage)
        .set({
          status: 'sent',
          attempts: attempt,
          providerMessageId: sent.providerMessageId,
          lastError: null,
          sentAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(emailMessage.id, payload.messageId));

      this.logger.log(`sent "${payload.template}" to ${payload.to} via ${this.transport.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exhausted = attempt >= (job.opts.attempts ?? 1);

      // The row stays `pending` while retries remain: marking it failed on the first
      // attempt would make the admin UI report a failure that the queue then quietly
      // fixes, which is worse than saying nothing.
      await this.db
        .update(emailMessage)
        .set({
          ...(exhausted ? { status: 'failed' as const } : {}),
          attempts: attempt,
          lastError: message.slice(0, 1_000),
          updatedAt: new Date(),
        })
        .where(eq(emailMessage.id, payload.messageId));

      this.logger.warn(
        `attempt ${attempt} to send "${payload.template}" to ${payload.to} failed: ${message}`,
      );
      throw error;
    }
  }
}
