/** Injection token for the configured transport. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

export interface OutgoingEmail {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export interface SentEmail {
  /** The provider's id, which is what a later bounce report refers to. */
  providerMessageId: string | null;
}

/**
 * What the rest of the application knows about sending email: one method.
 *
 * The interface is this small on purpose. Everything that varies between a local
 * Mailpit and production SES — authentication, configuration sets, rate limits — is
 * the transport's problem, and the queue above it treats both the same way: a call
 * that either returns or throws, where throwing means retry.
 */
export interface MailTransport {
  readonly name: string;
  send(email: OutgoingEmail): Promise<SentEmail>;
}
