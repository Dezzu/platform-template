import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminUsersService } from './admin-users.service';

@Module({
  controllers: [AdminController],
  providers: [AdminUsersService, AdminOrganizationsService],
})
export class AdminModule {}
