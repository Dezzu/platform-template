import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  DeletionRequestCreateSchema,
  DeletionRequestSchema,
  GdprExportDownloadSchema,
  GdprExportRequestSchema,
  PERMISSIONS,
  type DeletionRequest,
  type DeletionRequestCreate,
  type GdprExportDownload,
  type GdprExportRequest,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { CurrentOrg, CurrentOrgOptional, type OrgContext } from '../../auth/org-context';
import { OrgOptional, RequirePermissions } from '../../auth/permissions.decorator';
import { GdprDeletionService } from './gdpr-deletion.service';
import { GdprExportService } from './gdpr-export.service';

/**
 * The two rights with machinery behind them: access and erasure.
 *
 * The scope is in the **route**, never in the body, and that is a security decision
 * rather than a style one. Exporting yourself needs no permission; exporting your
 * employer needs `gdpr.export`, and erasing the tenant needs `org.delete` — three
 * different answers that a guard has to give before anything reads a body. One
 * endpoint taking `{ scope }` would have to make that decision inside the handler,
 * which is where forgotten checks live.
 */
@ApiTags('gdpr')
@ApiStandardErrors()
@Controller('gdpr')
export class GdprController {
  constructor(
    private readonly exports: GdprExportService,
    private readonly deletions: GdprDeletionService,
  ) {}

  // ── Access ─────────────────────────────────────────────────────────────────

  @Get('exports')
  @OrgOptional()
  @ApiOperation({ summary: 'The exports you have asked for' })
  @ApiEnvelope(GdprExportRequestSchema.array())
  listExports(@Session() session: UserSession): Promise<GdprExportRequest[]> {
    return this.exports.listMine(session.user.id);
  }

  /**
   * Your own data. No permission and no tenant: it is an answer about a person, and
   * the same account can belong to several organizations or to none.
   */
  @Post('exports/me')
  @OrgOptional()
  // 202: the archive does not exist yet. Returning 201 would suggest something is
  // there to fetch, which is exactly the misunderstanding the status code prevents.
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Ask for a copy of your own data' })
  @ApiEnvelope(GdprExportRequestSchema)
  requestPersonalExport(@Session() session: UserSession): Promise<GdprExportRequest> {
    return this.exports.request(session.user.id, 'user', null);
  }

  /** The whole tenant, including every member's personal data — hence a permission. */
  @Post('exports/organization')
  @RequirePermissions(PERMISSIONS.GDPR_EXPORT)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: "Ask for a copy of the organization's data" })
  @ApiEnvelope(GdprExportRequestSchema)
  requestOrganizationExport(@CurrentOrg() org: OrgContext): Promise<GdprExportRequest> {
    return this.exports.request(org.userId, 'organization', org.organizationId);
  }

  /**
   * A fresh presigned URL, minted per click.
   *
   * The link is never stored and never emailed: while it is valid it *is* the archive,
   * and an archive is every piece of personal data the product holds about somebody.
   */
  @Get('exports/:id/download')
  @OrgOptional()
  @ApiOperation({ summary: 'A short-lived link to the archive' })
  @ApiEnvelope(GdprExportDownloadSchema)
  download(@Session() session: UserSession, @Param('id') id: string): Promise<GdprExportDownload> {
    return this.exports.download(session.user.id, id);
  }

  // ── Erasure ────────────────────────────────────────────────────────────────

  @Get('deletion-requests')
  @OrgOptional()
  @ApiOperation({ summary: 'Erasures pending for you or your organization' })
  @ApiEnvelope(DeletionRequestSchema.array())
  listDeletions(
    @Session() session: UserSession,
    @CurrentOrgOptional() org: OrgContext | null,
  ): Promise<DeletionRequest[]> {
    return this.deletions.listForCaller(session.user.id, org?.organizationId ?? null);
  }

  @Post('deletion-requests/account')
  @OrgOptional()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Schedule the erasure of your own account' })
  @ApiEnvelope(DeletionRequestSchema)
  scheduleAccountDeletion(
    @Session() session: UserSession,
    @Body({ schema: DeletionRequestCreateSchema }) body: DeletionRequestCreate,
    @CurrentOrgOptional() org: OrgContext | null,
  ): Promise<DeletionRequest> {
    return this.deletions.schedule(
      { id: session.user.id, email: session.user.email, name: session.user.name },
      'user',
      body,
      org?.organizationId ?? null,
    );
  }

  /**
   * `org.delete`, which only an owner holds. An admin who could erase the tenant is an
   * admin who can end the company's account — the same reason they cannot change what
   * it pays.
   */
  @Post('deletion-requests/organization')
  @RequirePermissions(PERMISSIONS.ORG_DELETE)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Schedule the erasure of the organization' })
  @ApiEnvelope(DeletionRequestSchema)
  scheduleOrganizationDeletion(
    @Session() session: UserSession,
    @CurrentOrg() org: OrgContext,
    @Body({ schema: DeletionRequestCreateSchema }) body: DeletionRequestCreate,
  ): Promise<DeletionRequest> {
    return this.deletions.schedule(
      { id: session.user.id, email: session.user.email, name: session.user.name },
      'organization',
      body,
      org.organizationId,
    );
  }

  /** Changing your mind, which is what the grace period is for. */
  @Delete('deletion-requests/:id')
  @OrgOptional()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Call off a pending erasure' })
  async cancelDeletion(
    @Session() session: UserSession,
    @CurrentOrgOptional() org: OrgContext | null,
    @Param('id') id: string,
  ): Promise<void> {
    await this.deletions.cancel(session.user.id, org?.organizationId ?? null, id);
  }
}
