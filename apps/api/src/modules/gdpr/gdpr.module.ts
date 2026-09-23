import { Module } from '@nestjs/common';
import { GdprController } from './gdpr.controller';
import { GdprDeletionService } from './gdpr-deletion.service';
import { GdprExportService } from './gdpr-export.service';
import { GdprProcessor } from './gdpr.processor';

/**
 * Access and erasure. Not global: nothing else raises either, and a feature that one
 * day needs to know whether a subject is being erased should ask through an explicit
 * import rather than discover it ambiently.
 *
 * Both services are exported for the recurring sweep, which lives on the maintenance
 * queue — expiring archives and enqueueing due erasures are chores, and there is one
 * processor per queue.
 */
@Module({
  controllers: [GdprController],
  providers: [GdprExportService, GdprDeletionService, GdprProcessor],
  exports: [GdprExportService, GdprDeletionService],
})
export class GdprModule {}
