import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { ConfigType } from '@nestjs/config';
import type { mailConfig } from '../../../config/namespaces';
import type { MailTransport, OutgoingEmail, SentEmail } from './mail-transport';

/**
 * Amazon SES v2.
 *
 * `ConfigurationSetName` is wired from the start even though the SNS side that reads
 * bounces and complaints arrives later. A configuration set only reports on mail sent
 * *through* it: add it after the first thousand sends and that history is gone, and
 * with it any way to explain why the domain's reputation moved.
 */
export class SesTransport implements MailTransport {
  readonly name = 'ses';
  private readonly client: SESv2Client;

  constructor(private readonly config: ConfigType<typeof mailConfig>) {
    this.client = new SESv2Client({
      region: config.aws.region,
      // Explicit credentials only when given: on ECS or EC2 the default provider chain
      // picks up the task role, which is the correct way to run this in production.
      ...(config.aws.accessKeyId
        ? {
            credentials: {
              accessKeyId: config.aws.accessKeyId,
              secretAccessKey: config.aws.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async send(email: OutgoingEmail): Promise<SentEmail> {
    const result = await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: email.from,
        Destination: { ToAddresses: [email.to] },
        ...(this.config.aws.configurationSet
          ? { ConfigurationSetName: this.config.aws.configurationSet }
          : {}),
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: email.html, Charset: 'UTF-8' },
              Text: { Data: email.text, Charset: 'UTF-8' },
            },
          },
        },
      }),
    );
    return { providerMessageId: result.MessageId ?? null };
  }
}
