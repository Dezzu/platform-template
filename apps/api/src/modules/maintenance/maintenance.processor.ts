import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { queueConfig } from '../../config/namespaces';
import { JOBS, QUEUES } from '../../queue/queue.constants';
import { QueueWorkerHost } from '../../queue/queue-worker.host';
import { FilesService } from '../files/files.service';

/**
 * The single consumer of the maintenance queue.
 *
 * One processor per queue is a BullMQ constraint, not a design choice, so recurring
 * chores dispatch by job name from here. The queue plumbing lives in this module; the
 * knowledge of *what* to clean up stays in the feature that owns the data — this class
 * should never grow a SQL statement.
 */
@Injectable()
@Processor(QUEUES.MAINTENANCE, { autorun: false })
export class MaintenanceProcessor extends QueueWorkerHost {
  constructor(
    private readonly files: FilesService,
    @Inject(queueConfig.KEY) queue: ConfigType<typeof queueConfig>,
  ) {
    super(QUEUES.MAINTENANCE, { runWorkers: queue.runWorkers, concurrency: 1 });
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOBS.FILES_JANITOR: {
        const removed = await this.files.sweepAbandonedUploads();
        if (removed > 0) this.logger.log(`swept ${removed} abandoned upload(s)`);
        return;
      }
      default:
        // A scheduler from a newer release, or a job name that was removed. Retrying
        // will not teach this process what it means.
        throw new UnrecoverableError(`unknown maintenance job "${job.name}"`);
    }
  }
}
