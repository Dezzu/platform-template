import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  FeatureFlagCreateSchema,
  FeatureFlagListQuerySchema,
  FeatureFlagSchema,
  FeatureFlagUpdateSchema,
  PLATFORM_PERMISSIONS,
  ResolvedFlagsSchema,
  zPaginated,
  type FeatureFlag,
  type FeatureFlagCreate,
  type FeatureFlagListQuery,
  type FeatureFlagUpdate,
  type Paginated,
  type ResolvedFlags,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { OrgOptional, RequirePlatformPermission } from '../../auth/permissions.decorator';
import { authHeaders } from '../../auth/better-auth.bridge';
import type { PlatformActor } from '../admin/admin-users.service';
import { FlagsService } from './flags.service';

interface RequestWithSession {
  headers: Record<string, string | string[] | undefined>;
  session?: { user?: { id: string; role?: string | null } };
}

/**
 * Two audiences, one resource, and the split is deliberate.
 *
 * `GET /flags` answers "what is on for me" and any signed-in caller may ask it — the
 * shell needs it to build the menu. Everything else edits what the product does for
 * everybody and is behind `platform.flags.manage`, which only a superadmin holds.
 */
@ApiTags('flags')
@ApiStandardErrors()
@Controller('flags')
export class FlagsController {
  constructor(private readonly flags: FlagsService) {}

  private actor(request: RequestWithSession): PlatformActor {
    return {
      userId: request.session?.user?.id ?? '',
      role: request.session?.user?.role ?? 'user',
      headers: authHeaders(request),
    };
  }

  /**
   * @OrgOptional() rather than a permission: the tenant is resolved when there is one,
   * because an organization override is the level most rollouts use, but somebody who
   * has not picked an organization still gets the global answer instead of a 400.
   */
  @Get()
  @OrgOptional()
  @ApiOperation({ summary: 'Every feature flag and whether it is on' })
  @ApiEnvelope(ResolvedFlagsSchema)
  resolve(): Promise<ResolvedFlags> {
    return this.flags.resolve();
  }

  /**
   * Before `:key`, or "definitions" would be read as a flag key — the router matches
   * in declaration order.
   */
  @Get('definitions')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)
  @ApiOperation({ summary: 'The flag definitions, as configured' })
  @ApiEnvelope(zPaginated(FeatureFlagSchema))
  list(
    @Query({ schema: FeatureFlagListQuerySchema }) query: FeatureFlagListQuery,
  ): Promise<Paginated<FeatureFlag>> {
    return this.flags.list(query);
  }

  @Get('definitions/:key')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)
  @ApiOperation({ summary: 'One flag definition' })
  @ApiEnvelope(FeatureFlagSchema)
  getOne(@Param('key') key: string): Promise<FeatureFlag> {
    return this.flags.getByKey(key);
  }

  @Post('definitions')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)
  @ApiOperation({ summary: 'Declare a new flag' })
  @ApiEnvelope(FeatureFlagSchema)
  create(
    @Req() request: RequestWithSession,
    @Body({ schema: FeatureFlagCreateSchema }) body: FeatureFlagCreate,
  ): Promise<FeatureFlag> {
    return this.flags.create(this.actor(request), body);
  }

  @Patch('definitions/:key')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)
  @ApiOperation({ summary: 'Change a flag' })
  @ApiEnvelope(FeatureFlagSchema)
  update(
    @Req() request: RequestWithSession,
    @Param('key') key: string,
    @Body({ schema: FeatureFlagUpdateSchema }) body: FeatureFlagUpdate,
  ): Promise<FeatureFlag> {
    return this.flags.update(this.actor(request), key, body);
  }

  @Delete('definitions/:key')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.FLAGS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a flag and every override of it' })
  remove(@Req() request: RequestWithSession, @Param('key') key: string): Promise<void> {
    return this.flags.remove(this.actor(request), key);
  }
}
