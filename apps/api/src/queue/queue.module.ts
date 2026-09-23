import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import type { ConfigType } from '@nestjs/config';
import { queueConfig, redisConfig } from '../config/namespaces';
import { QUEUES } from './queue.constants';

/**
 * The queue layer.
 *
 * Background work exists here for one reason: **an HTTP handler must never do work the
 * caller is not waiting for**. Sending an invitation inline means the invite fails
 * because SES had a bad minute, and the member is never added. Enqueueing means the
 * member is added and the email is retried.
 *
 * Retry policy is set once, here, rather than per producer: five attempts with
 * exponential backoff covers the failure that background work actually has — a
 * dependency that is briefly unavailable — and a job that fails five times over
 * roughly eight minutes is not going to succeed on the sixth.
 *
 * `removeOnComplete: true` for the email queue is deliberate and is a security
 * property, not housekeeping: the job payload carries the live verification or reset
 * link, and a completed job kept "for observability" is that link sitting in Redis.
 * What happened is recorded in `email_message`, which holds no secrets.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [redisConfig.KEY, queueConfig.KEY],
      useFactory: (
        redis: ConfigType<typeof redisConfig>,
        queue: ConfigType<typeof queueConfig>,
      ) => ({
        connection: {
          url: redis.url,
          /**
           * Required by BullMQ, not a preference: a worker blocks on BZPOPMIN, and with
           * a finite retry budget that command eventually throws and the worker stops
           * consuming — silently, with the process still up and healthy.
           */
          maxRetriesPerRequest: null,
        },
        prefix: queue.prefix,
        defaultJobOptions: {
          attempts: queue.attempts,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { age: 3_600, count: 1_000 },
          removeOnFail: { age: 7 * 24 * 3_600 },
        },
      }),
    }),

    BullModule.registerQueue(
      { name: QUEUES.EMAIL, defaultJobOptions: { removeOnComplete: true } },
      { name: QUEUES.MAINTENANCE },
      { name: QUEUES.GDPR },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
