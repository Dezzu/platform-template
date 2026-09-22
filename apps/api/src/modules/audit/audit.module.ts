import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditRepository } from './audit.repository';
import { AuditService } from './audit.service';

/**
 * Global because nearly every feature module records entries.
 *
 * Writing and reading are separate on purpose: `AuditService` is what features inject
 * and it only appends, while the repository behind the controller only reads. Nothing
 * in the application can amend or remove an entry.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
