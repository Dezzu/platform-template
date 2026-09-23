import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { queueConfig } from '../../config/namespaces';
import { JOBS, QUEUES } from '../../queue/queue.constants';

/**
 * Declares the recurring jobs.
 *
 * `upsertJobScheduler` rather than `add({ repeat })`: it is keyed, so booting ten API
 * containers declares one schedule rather than ten, and changing the interval replaces
 * the old one instead of leaving it running forever alongside the new one. A duplicated
 * cron is the classic way a nightly cleanup starts firing every few minutes.
 *
 * Registered by producers, not by workers: a deployment that runs only API containers
 * must still keep the schedule current.
 */
@Injectable()
export class MaintenanceScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(MaintenanceScheduler.name);

  constructor(
    @InjectQueue(QUEUES.MAINTENANCE) private readonly queue: Queue,
    @Inject(queueConfig.KEY) private readonly config: ConfigType<typeof queueConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    void this.config;

    await this.queue.upsertJobScheduler(
      JOBS.FILES_JANITOR,
      // 03:15 UTC. Not midnight: everyone's cron runs at midnight, and the shared
      // Postgres has enough to do at that hour already.
      { pattern: '15 3 * * *' },
      {
        name: JOBS.FILES_JANITOR,
        // A missed sweep is picked up by the next one; retrying a cleanup that failed
        // because storage was down achieves nothing tonight.
        opts: { attempts: 1, removeOnComplete: { count: 30 } },
      },
    );

    await this.queue.upsertJobScheduler(
      JOBS.GDPR_SWEEP,
      // Hourly, not nightly. An archive expires at a wall-clock time and an erasure
      // falls due at one; a daily sweep would mean a retention window that is "48
      // hours, give or take a day", which is not what the policy says.
      { pattern: '25 * * * *' },
      {
        name: JOBS.GDPR_SWEEP,
        opts: { attempts: 1, removeOnComplete: { count: 48 } },
      },
    );

    this.logger.log(`scheduled "${JOBS.FILES_JANITOR}" and "${JOBS.GDPR_SWEEP}"`);
  }
}
