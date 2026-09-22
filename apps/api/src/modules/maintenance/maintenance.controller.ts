import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  MaintenanceModeSchema,
  MaintenanceModeUpdateSchema,
  PLATFORM_PERMISSIONS,
  type MaintenanceMode,
  type MaintenanceModeUpdate,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { RequirePlatformPermission } from '../../auth/permissions.decorator';
import { authHeaders } from '../../auth/better-auth.bridge';
import type { PlatformActor } from '../admin/admin-users.service';
import { AllowDuringMaintenance } from './maintenance.decorator';
import { MaintenanceModeService } from './maintenance-mode.service';

interface RequestWithSession {
  headers: Record<string, string | string[] | undefined>;
  session?: { user?: { id: string; role?: string | null } };
}

/**
 * Reading and setting maintenance mode.
 *
 * Both routes carry @AllowDuringMaintenance(), and that is the point: an administrator
 * who has just taken the product offline must be able to load this screen and put it
 * back. Without the exemption the only way out of a mistake would be an UPDATE against
 * the production database.
 */
@ApiTags('maintenance')
@ApiStandardErrors()
@Controller('maintenance')
@AllowDuringMaintenance()
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceModeService) {}

  private actor(request: RequestWithSession): PlatformActor {
    return {
      userId: request.session?.user?.id ?? '',
      role: request.session?.user?.role ?? 'user',
      headers: authHeaders(request),
    };
  }

  @Get()
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'The current maintenance setting' })
  @ApiEnvelope(MaintenanceModeSchema)
  get(): Promise<MaintenanceMode> {
    return this.maintenance.get();
  }

  @Put()
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE)
  @ApiOperation({ summary: 'Take the product offline, or bring it back' })
  @ApiEnvelope(MaintenanceModeSchema)
  set(
    @Req() request: RequestWithSession,
    @Body({ schema: MaintenanceModeUpdateSchema }) body: MaintenanceModeUpdate,
  ): Promise<MaintenanceMode> {
    return this.maintenance.set(this.actor(request), body);
  }
}
