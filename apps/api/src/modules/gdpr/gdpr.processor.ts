import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Processor } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { z } from 'zod';
import { queueConfig } from '../../config/namespaces';
import { JOBS, QUEUES } from '../../queue/queue.constants';
import { QueueWorkerHost } from '../../queue/queue-worker.host';
import { GdprDeletionService } from './gdpr-deletion.service';
import { GdprExportService } from './gdpr-export.service';

/** Both jobs carry one thing: which row to work on. Everything else is read from it. */
const RequestJobSchema = z.object({ requestId: z.uuid() });

/**
 * The single consumer of the GDPR queue.
 *
 * Concurrency of one, deliberately. An export reads most of a tenant and an erasure
 * deletes across a dozen tables; running several at once would multiply that load for
 * work nobody is waiting on by the second.
 */
@Injectable()
@Processor(QUEUES.GDPR, { autorun: false })
export class GdprProcessor extends QueueWorkerHost {
  constructor(
    private readonly exports: GdprExportService,
    private readonly deletions: GdprDeletionService,
    @Inject(queueConfig.KEY) queue: ConfigType<typeof queueConfig>,
  ) {
    super(QUEUES.GDPR, { runWorkers: queue.runWorkers, concurrency: 1 });
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOBS.GDPR_EXPORT: {
        const { requestId } = this.parse(RequestJobSchema, job.data);
        await this.exports.run(requestId);
        return;
      }
      case JOBS.GDPR_DELETE: {
        const { requestId } = this.parse(RequestJobSchema, job.data);
        await this.deletions.execute(requestId);
        return;
      }
      default:
        // A job name from a newer release, or one that was removed. Five retries will
        // not teach this process what it means.
        throw new UnrecoverableError(`unknown gdpr job "${job.name}"`);
    }
  }
}
