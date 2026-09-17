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
  InvitationCreateSchema,
  InvitationSchema,
  MemberListQuerySchema,
  MemberRoleUpdateSchema,
  MemberSchema,
  PERMISSIONS,
  zPaginated,
  type Invitation,
  type InvitationCreate,
  type Member,
  type MemberListQuery,
  type MemberRoleUpdate,
  type Paginated,
} from '@app/contracts';
import { z } from 'zod';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { CurrentOrg, type OrgContext } from '../../auth/org-context';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { authHeaders } from '../../auth/better-auth.bridge';
import { MembersService } from './members.service';

/** Express's request, narrowed to what the Better Auth bridge needs. */
interface RequestWithHeaders {
  headers: Record<string, string | string[] | undefined>;
}

@ApiTags('members')
@ApiStandardErrors()
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.MEMBERS_READ)
  @ApiOperation({ summary: 'List the members of the active organization' })
  @ApiEnvelope(zPaginated(MemberSchema))
  list(
    @CurrentOrg() org: OrgContext,
    @Query({ schema: MemberListQuerySchema }) query: MemberListQuery,
  ): Promise<Paginated<Member>> {
    return this.members.list(org, query);
  }

  @Get('invitations')
  @RequirePermissions(PERMISSIONS.MEMBERS_READ)
  @ApiOperation({ summary: 'List the invitations still awaiting an answer' })
  @ApiEnvelope(z.array(InvitationSchema))
  listInvitations(
    @CurrentOrg() org: OrgContext,
    @Req() request: RequestWithHeaders,
  ): Promise<Invitation[]> {
    return this.members.listInvitations(org, authHeaders(request));
  }

  @Post('invitations')
  @RequirePermissions(PERMISSIONS.MEMBERS_INVITE)
  @ApiOperation({ summary: 'Invite someone by email' })
  @ApiEnvelope(InvitationSchema, { status: HttpStatus.CREATED })
  invite(
    @CurrentOrg() org: OrgContext,
    @Req() request: RequestWithHeaders,
    @Body({ schema: InvitationCreateSchema }) body: InvitationCreate,
  ): Promise<Invitation> {
    return this.members.invite(org, authHeaders(request), body);
  }

  @Delete('invitations/:id')
  @RequirePermissions(PERMISSIONS.MEMBERS_INVITE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a pending invitation' })
  cancelInvitation(
    @CurrentOrg() org: OrgContext,
    @Req() request: RequestWithHeaders,
    @Param('id') id: string,
  ): Promise<void> {
    return this.members.cancelInvitation(org, authHeaders(request), id);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.MEMBERS_MANAGE)
  @ApiOperation({ summary: "Change a member's role" })
  @ApiEnvelope(MemberSchema)
  updateRole(
    @CurrentOrg() org: OrgContext,
    @Req() request: RequestWithHeaders,
    @Param('id') id: string,
    @Body({ schema: MemberRoleUpdateSchema }) body: MemberRoleUpdate,
  ): Promise<Member> {
    return this.members.updateRole(org, authHeaders(request), id, body.role);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.MEMBERS_REMOVE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a member from the organization' })
  remove(
    @CurrentOrg() org: OrgContext,
    @Req() request: RequestWithHeaders,
    @Param('id') id: string,
  ): Promise<void> {
    return this.members.remove(org, authHeaders(request), id);
  }
}
