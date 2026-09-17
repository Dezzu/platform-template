import type { MailService } from './mail.service';

/**
 * A module-scope handle on MailService, for `auth.config.ts` alone.
 *
 * Better Auth is constructed as a module singleton rather than a Nest provider,
 * because its CLI imports that file directly to generate the Drizzle schema and has no
 * DI container. Its hooks — verification, password reset, invitations — nonetheless
 * need to send email through the queue rather than inline.
 *
 * This is the seam between the two worlds, and it is deliberately one variable with
 * two functions rather than a service locator: exactly one consumer, registered once
 * at boot, and a loud failure if anything reaches for it earlier.
 */
let mailer: MailService | null = null;

export function registerAuthMailer(service: MailService): void {
  mailer = service;
}

export function authMailer(): MailService {
  if (!mailer) {
    // A silent no-op here means signups that never receive their verification link
    // and nothing in the logs. Better to fail the request.
    throw new Error('MailService is not registered yet — is MailModule imported in AppModule?');
  }
  return mailer;
}

/** Test seam; also used to prove the failure mode above is a failure. */
export function resetAuthMailer(): void {
  mailer = null;
}
