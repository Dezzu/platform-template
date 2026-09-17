import { Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { WorkerHost } from '@nestjs/bullmq';
import { UnrecoverableError } from 'bullmq';
import type { z } from 'zod';

/**
 * Base class for every processor.
 *
 * It exists for two reasons.
 *
 * **Workers start on command, not on import.** Processors are declared with
 * `@Processor(name, { autorun: false })`, so loading the module connects to Redis but
 * consumes nothing until `onApplicationBootstrap` decides. That is what makes
 * QUEUE_RUN_WORKERS a runtime switch: the same image runs as an API container that
 * only produces and as a worker container that consumes, with no separate build.
 *
 * **A poisoned payload must fail loudly and once.** `parse` validates job data against
 * a schema and raises `UnrecoverableError` when it does not match — a payload that is
 * the wrong shape will be the wrong shape on the fifth retry too, and five attempts
 * with backoff only delays the moment someone notices. The job goes straight to the
 * failed set with the validation issues attached.
 */
export abstract class QueueWorkerHost extends WorkerHost implements OnApplicationBootstrap {
  protected readonly logger: Logger;

  protected constructor(
    private readonly queueName: string,
    private readonly options: { runWorkers: boolean; concurrency: number },
  ) {
    super();
    this.logger = new Logger(`${queueName}-worker`);
  }

  onApplicationBootstrap(): void {
    if (!this.options.runWorkers) {
      this.logger.log(`worker disabled (QUEUE_RUN_WORKERS=false) — queue "${this.queueName}"`);
      return;
    }
    // Set here rather than in the decorator: the decorator's options are evaluated at
    // import time, before the configuration has been validated.
    this.worker.concurrency = this.options.concurrency;
    if (!this.worker.isRunning()) void this.worker.run();
    this.logger.log(
      `consuming queue "${this.queueName}" with concurrency ${this.options.concurrency}`,
    );
  }

  /** Validates job data, or fails the job permanently. */
  protected parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
    const result = schema.safeParse(data);

    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');
      throw new UnrecoverableError(`invalid job payload — ${detail}`);
    }

    return result.data;
  }
}
