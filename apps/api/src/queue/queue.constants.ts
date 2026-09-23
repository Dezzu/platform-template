/**
 * Every queue in the system, named once.
 *
 * A queue name is a wire format: the producer writes into Redis under this string and
 * the consumer reads from it, and the two are separate processes that are upgraded at
 * different moments. Renaming one strands whatever is already enqueued, so treat these
 * like the error codes — append, do not rename.
 */
export const QUEUES = {
  EMAIL: 'email',
  MAINTENANCE: 'maintenance',
  /**
   * Its own queue rather than another job name on `maintenance`: building an export
   * reads half the database and writing an erasure deletes across a dozen tables, and
   * either one sitting in the chores queue would hold up the file janitor behind it.
   */
  GDPR: 'gdpr',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job names within a queue. Same rule: they are persisted, so they are append-only. */
export const JOBS = {
  EMAIL_SEND: 'email.send',
  FILES_JANITOR: 'files.janitor',
  GDPR_EXPORT: 'gdpr.export',
  GDPR_DELETE: 'gdpr.delete',
  /** Recurring, on the maintenance queue: expire old archives, enqueue due erasures. */
  GDPR_SWEEP: 'gdpr.sweep',
} as const;
