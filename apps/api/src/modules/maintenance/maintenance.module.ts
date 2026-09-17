import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { MaintenanceProcessor } from './maintenance.processor';
import { MaintenanceScheduler } from './maintenance.scheduler';

@Module({
  imports: [FilesModule],
  providers: [MaintenanceProcessor, MaintenanceScheduler],
})
export class MaintenanceModule {}
