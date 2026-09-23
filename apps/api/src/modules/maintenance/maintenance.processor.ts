import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { queueConfig } from '../../config/namespaces';
import { JOBS, QUEUES } from '../../queue/queue.constants';
import { QueueWorkerHost } from '../../queue/queue-worker.host';
import { FilesService } from '../files/files.service';
import { GdprDeletionService } from '../gdpr/gdpr-deletion.service';
import { GdprExportService } from '../gdpr/gdpr-export.service';

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
    private readonly exports: GdprExportService,
    private readonly deletions: GdprDeletionService,
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
      case JOBS.GDPR_SWEEP: {
        /**
         * Two chores that share a clock and nothing else: archives whose retention
         * window has passed are deleted, and erasures that have fallen due are handed
         * to the GDPR queue. Neither runs the work itself — this one only decides that
         * the moment has come.
         */
        const [expired, due] = await Promise.all([
          this.exports.sweepExpired(),
          this.deletions.sweepDue(),
        ]);
        if (expired > 0) this.logger.log(`expired ${expired} export archive(s)`);
        if (due > 0) this.logger.log(`enqueued ${due} due erasure(s)`);
        return;
      }
      default:
        // A scheduler from a newer release, or a job name that was removed. Retrying
        // will not teach this process what it means.
        throw new UnrecoverableError(`unknown maintenance job "${job.name}"`);
    }
  }
}
