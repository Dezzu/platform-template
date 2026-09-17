import { createTransport, type Transporter } from 'nodemailer';
import type { ConfigType } from '@nestjs/config';
import type { mailConfig } from '../../../config/namespaces';
import type { MailTransport, OutgoingEmail, SentEmail } from './mail-transport';

/**
 * SMTP, which in development means the Mailpit container.
 *
 * Deliberately usable in production too: not every deployment of this template has an
 * AWS account, and a managed SMTP provider is a legitimate choice. What the config
 * validation refuses is *this* configuration in production — localhost:1025 with no
 * credentials, which would silently send nothing.
 */
export class SmtpTransport implements MailTransport {
  readonly name = 'smtp';
  private readonly transporter: Transporter;

  constructor(config: ConfigType<typeof mailConfig>) {
    this.transporter = createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      ...(config.smtp.user ? { auth: { user: config.smtp.user, pass: config.smtp.password } } : {}),
      // Mailpit presents a self-signed certificate; nothing sensitive crosses a
      // loopback connection to it, and production uses `ses` or a real SMTP host.
      ...(config.smtp.host === 'localhost' || config.smtp.host === '127.0.0.1'
        ? { tls: { rejectUnauthorized: false } }
        : {}),
    });
  }

  async send(email: OutgoingEmail): Promise<SentEmail> {
    const info = await this.transporter.sendMail({
      from: email.from,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
    return { providerMessageId: info.messageId ?? null };
  }
}
