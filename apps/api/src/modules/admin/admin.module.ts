import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminUsersService } from './admin-users.service';
import { AdminMetricsController } from './metrics/admin-metrics.controller';
import { PlatformMetricsService } from './metrics/platform-metrics.service';

@Module({
  controllers: [AdminController, AdminMetricsController],
  providers: [AdminUsersService, AdminOrganizationsService, PlatformMetricsService],
})
export class AdminModule {}
