import { z } from 'zod';

/**
 * What travels in the queue.
 *
 * The full render parameters are here and NOT in `email_message`, which stores them
 * redacted: a verification or reset link is a bearer credential, and the job is
 * deleted the instant the send succeeds while the table row is kept forever.
 *
 * The payload is re-validated by the worker. A job enqueued by the previous release
 * and consumed by the next one is the normal case during a rolling deploy, so "the
 * producer already checked it" is not a guarantee the consumer has.
 */
export const EmailJobSchema = z.object({
  messageId: z.uuid(),
  template: z.string().min(1),
  locale: z.string().min(1),
  to: z.email(),
  params: z.record(z.string(), z.unknown()),
});

export type EmailJob = z.infer<typeof EmailJobSchema>;
