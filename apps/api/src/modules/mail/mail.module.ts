import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { mailConfig } from '../../config/namespaces';
import { registerAuthMailer } from './mail.bridge';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { MAIL_TRANSPORT, type MailTransport } from './transports/mail-transport';
import { SesTransport } from './transports/ses.transport';
import { SmtpTransport } from './transports/smtp.transport';

/**
 * Global: nearly every feature eventually sends something, and threading an import
 * through each one buys nothing.
 *
 * The transport is chosen once, here, from MAIL_DRIVER. Nothing downstream knows which
 * one it got — that is the point of the interface, and it is what makes "the same code
 * path that runs in production also runs against Mailpit" true rather than aspirational.
 */
@Global()
@Module({
  providers: [
    MailService,
    MailProcessor,
    {
      provide: MAIL_TRANSPORT,
      inject: [mailConfig.KEY],
      useFactory: (config: ConfigType<typeof mailConfig>): MailTransport =>
        config.driver === 'ses' ? new SesTransport(config) : new SmtpTransport(config),
    },
  ],
  exports: [MailService],
})
export class MailModule {
  constructor(mail: MailService) {
    // Hands Better Auth's module-scope hooks a way into the queue. See mail.bridge.ts.
    registerAuthMailer(mail);
  }
}
