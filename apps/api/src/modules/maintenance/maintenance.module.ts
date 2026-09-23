import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { GdprModule } from '../gdpr/gdpr.module';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceModeService } from './maintenance-mode.service';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

/**
 * Two things share the name and the module, and they are less unrelated than they
 * look: both are about the product being temporarily not itself. The queue side runs
 * the recurring chores; the mode side takes the whole API offline on purpose.
 *
 * MaintenanceModeService is exported because the globally registered guard and
 * MeController both need it.
 */
@Module({
  imports: [FilesModule, GdprModule],
  controllers: [MaintenanceController],
  providers: [MaintenanceModeService, MaintenanceProcessor, MaintenanceScheduler],
  exports: [MaintenanceModeService],
})
export class MaintenanceModule {}
