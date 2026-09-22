import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
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
 * no permission of ours to check.
 *
 * Reading the invitation is anonymous, because the person it is for usually has no
 * account: the link exists to let them make one, and a preview behind a session turns
 * it into a login form they cannot satisfy. What protects it is that the id is a long
 * random token that was emailed to the invited address, and that reading grants
 * nothing.
 *
 * Accepting is a different matter and keeps its session: Better Auth refuses unless
 * the signed-in address is the invited one, which is what stops a forwarded link from
 * adding whoever it was forwarded to.
 */
@ApiTags('invitations')
@ApiStandardErrors()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly members: MembersService) {}

  @Get(':id')
  @AllowAnonymous()
  @ApiOperation({ summary: 'What an invitation says, for whoever holds the link' })
  @ApiEnvelope(InvitationPreviewSchema)
  preview(@Param('id') id: string): Promise<InvitationPreview> {
    return this.members.preview(id);
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
