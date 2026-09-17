import type { INestApplication } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { emailMessage, user } from '@app/db';
import { db } from '../src/database/db';
import { createTestApp } from './app.factory';
import { signUp, type TestUser } from './helpers/auth';

const MAILPIT = 'http://localhost:8025';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

/** Mailpit keeps everything in memory; the search API is how you read it back. */
async function findInMailpit(address: string): Promise<MailpitMessage | undefined> {
  const response = await fetch(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`,
  );
  if (!response.ok) return undefined;
  const body = (await response.json()) as { messages?: MailpitMessage[] };
  return body.messages?.[0];
}

async function until<T>(
  attempt: () => Promise<T | undefined>,
  { timeoutMs = 10_000, everyMs = 250 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await attempt();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error('timed out waiting for the expected state');
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

/**
 * The whole delivery chain, end to end: a Better Auth hook → MailService → the BullMQ
 * queue → the worker → SMTP → Mailpit.
 *
 * Every link here has failed at least once in a way that compiles and passes a unit
 * test — a hook that is never wired, a bridge that is never populated, a worker that
 * connects but never consumes. Only the round trip catches those.
 */
describe('mail: signup verification reaches the inbox (e2e)', () => {
  let app: INestApplication;
  let newcomer: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    if (newcomer) {
      await db.delete(emailMessage).where(eq(emailMessage.toEmail, newcomer.email));
      await db.delete(user).where(inArray(user.id, [newcomer.id]));
    }
    await app.close();
  });

  it('queues the verification email, sends it, and records the send without the link', async () => {
    newcomer = await signUp(app, 'mail');

    const sent = await until(async () => {
      const [row] = await db
        .select()
        .from(emailMessage)
        .where(
          and(
            eq(emailMessage.toEmail, newcomer.email),
            eq(emailMessage.template, 'email-verification'),
          ),
        );
      return row?.status === 'sent' ? row : undefined;
    });

    expect(sent.providerMessageId).toBeTruthy();
    expect(sent.sentAt).not.toBeNull();
    expect(sent.attempts).toBe(1);
    expect(sent.lastError).toBeNull();
    expect(sent.userId).toBe(newcomer.id);
    // No tenant exists at signup — this is the documented exception to the
    // organization_id rule, and the reason the column is nullable.
    expect(sent.organizationId).toBeNull();

    // The row proves the email was sent; it must not also hand out the link, which is
    // a bearer credential for as long as it is valid.
    expect(sent.params).toMatchObject({ url: '[redacted]' });

    const delivered = await until(() => findInMailpit(newcomer.email));
    expect(delivered.To[0]?.Address).toBe(newcomer.email);
    expect(delivered.Subject).toContain('Conferma');

    // And the body carries the real link, which never touched the database.
    const source = await fetch(`${MAILPIT}/api/v1/message/${delivered.ID}`);
    const message = (await source.json()) as { HTML: string; Text: string };
    expect(message.HTML).toContain('/api/auth/verify-email');
    // Deliverability: an email with no plain-text part is scored as spam.
    expect(message.Text.length).toBeGreaterThan(0);
  });
});
