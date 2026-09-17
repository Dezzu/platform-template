import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InvitationPreviewSchema, type InvitationPreview } from '@app/contracts';
import { z } from 'zod';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { authHeaders } from '../../auth/better-auth.bridge';
import { MembersService } from './members.service';

interface RequestWithSession {
  headers: Record<string, string | string[] | undefined>;
  session?: { user?: { id: string } };
}

/**
 * The recipient's side of an invitation.
 *
 * Deliberately NOT organization-scoped, and that is the whole difficulty of this
 * endpoint: whoever calls it is not a member yet, so there is no tenant to resolve and
 * no permission of ours to check. Authentication is all we have — the route carries no
 * @RequirePermissions, so the guard stops at "is there a session".
 *
 * What stops it from being a way to read any invitation by guessing an id is Better
 * Auth: it refuses unless the signed-in address is the invited one.
 */
@ApiTags('invitations')
@ApiStandardErrors()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @Get(':id')
  @ApiOperation({ summary: 'What an invitation says, for the person who received it' })
  @ApiEnvelope(InvitationPreviewSchema)
  preview(@Req() request: RequestWithSession, @Param('id') id: string): Promise<InvitationPreview> {
    return this.members.preview(authHeaders(request), id);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an invitation and join the organization' })
  @ApiEnvelope(z.object({ organizationId: z.string() }))
  accept(
    @Req() request: RequestWithSession,
    @Param('id') id: string,
  ): Promise<{ organizationId: string }> {
    const userId = request.session?.user?.id ?? '';
    return this.members.accept(userId, authHeaders(request), id);
  }
}
