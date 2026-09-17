import {
  Body,
  Controller,
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
import type { ConfigType } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import {
  AdminBanSchema,
  AdminOrganizationDetailSchema,
  AdminOrgRoleUpdateSchema,
  AdminOrganizationListQuerySchema,
  AdminOrganizationSchema,
  AdminRoleUpdateSchema,
  AdminUserDetailSchema,
  AdminUserListQuerySchema,
  AdminUserSchema,
  PLATFORM_PERMISSIONS,
  zPaginated,
  type AdminBan,
  type AdminOrganization,
  type AdminOrgRoleUpdate,
  type AdminOrganizationDetail,
  type AdminOrganizationListQuery,
  type AdminRoleUpdate,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserListQuery,
  type Paginated,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { appConfig } from '../../config/namespaces';
import { RequirePlatformPermission } from '../../auth/permissions.decorator';
import { authHeaders } from '../../auth/better-auth.bridge';
import { AdminOrganizationsService } from './admin-organizations.service';
import { AdminUsersService, type PlatformActor } from './admin-users.service';

interface RequestWithSession {
  headers: Record<string, string | string[] | undefined>;
  session?: { user?: { id: string; role?: string | null } };
}

/**
 * Platform administration: every account and every organization, across tenants.
 *
 * The only controller in the application that is not tenant-scoped, and the reason it
 * uses @RequirePlatformPermission rather than @RequirePermissions: these rights come
 * from `user.role`, not from membership, and the guard skips tenant resolution
 * entirely. An organization admin must never be able to reach any of this.
 */
@ApiTags('admin')
@ApiStandardErrors()
@Controller('admin')
export class AdminController {
  constructor(
    private readonly users: AdminUsersService,
    private readonly organizations: AdminOrganizationsService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /** Who is asking, taken from the session — never from anything the client sent. */
  private actor(request: RequestWithSession): PlatformActor {
    return {
      userId: request.session?.user?.id ?? '',
      role: request.session?.user?.role ?? 'user',
      headers: authHeaders(request),
    };
  }

  @Get('users')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'List every account on the platform' })
  @ApiEnvelope(zPaginated(AdminUserSchema))
  listUsers(
    @Query({ schema: AdminUserListQuerySchema }) query: AdminUserListQuery,
  ): Promise<Paginated<AdminUser>> {
    return this.users.list(query);
  }

  @Get('users/:id')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'One account, with its organizations' })
  @ApiEnvelope(AdminUserDetailSchema)
  getUser(@Param('id') id: string): Promise<AdminUserDetail> {
    return this.users.getById(id);
  }

  @Patch('users/:id/role')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
  @ApiOperation({ summary: "Change an account's platform role" })
  @ApiEnvelope(AdminUserSchema)
  setRole(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Body({ schema: AdminRoleUpdateSchema }) body: AdminRoleUpdate,
  ): Promise<AdminUser> {
    return this.users.setRole(this.actor(request), id, body.role);
  }

  @Post('users/:id/password-reset')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Email the account a password reset link' })
  sendPasswordReset(@Req() request: RequestWithSession, @Param('id') id: string): Promise<void> {
    // The dashboard page that the emailed link eventually lands on.
    return this.users.sendPasswordReset(
      this.actor(request),
      id,
      `${this.app.dashboardUrl}/reset-password`,
    );
  }

  @Post('users/:id/verification-email')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Re-send the address confirmation email' })
  sendVerificationEmail(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
  ): Promise<void> {
    return this.users.sendVerificationEmail(
      this.actor(request),
      id,
      `${this.app.dashboardUrl}/dashboard`,
    );
  }

  @Post('users/:id/ban')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Ban an account and end its sessions' })
  ban(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
    @Body({ schema: AdminBanSchema }) body: AdminBan,
  ): Promise<void> {
    return this.users.ban(this.actor(request), id, body);
  }

  @Post('users/:id/unban')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Lift a ban' })
  unban(@Req() request: RequestWithSession, @Param('id') id: string): Promise<void> {
    return this.users.unban(this.actor(request), id);
  }

  @Post('users/:id/revoke-sessions')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.USERS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign the account out everywhere' })
  revokeSessions(@Req() request: RequestWithSession, @Param('id') id: string): Promise<void> {
    return this.users.revokeSessions(this.actor(request), id);
  }

  @Get('organizations')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_READ)
  @ApiOperation({ summary: 'List every organization on the platform' })
  @ApiEnvelope(zPaginated(AdminOrganizationSchema))
  listOrganizations(
    @Query({ schema: AdminOrganizationListQuerySchema }) query: AdminOrganizationListQuery,
  ): Promise<Paginated<AdminOrganization>> {
    return this.organizations.list(query);
  }

  @Patch('organizations/:organizationId/members/:userId/role')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Change a member's role inside an organization" })
  setMemberRole(
    @Req() request: RequestWithSession,
    @Param('organizationId') organizationId: string,
    @Param('userId') userId: string,
    @Body({ schema: AdminOrgRoleUpdateSchema }) body: AdminOrgRoleUpdate,
  ): Promise<void> {
    return this.organizations.setMemberRole(this.actor(request), organizationId, userId, body.role);
  }

  @Get('organizations/:id')
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.ORGANIZATIONS_READ)
  @ApiOperation({ summary: 'One organization, with its members and plan' })
  @ApiEnvelope(AdminOrganizationDetailSchema)
  getOrganization(@Param('id') id: string): Promise<AdminOrganizationDetail> {
    return this.organizations.getById(id);
  }
}
