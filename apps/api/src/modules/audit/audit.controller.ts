import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuditEntrySchema,
  AuditFacetsSchema,
  AuditListQuerySchema,
  PERMISSIONS,
  zPaginated,
  type AuditEntry,
  type AuditFacets,
  type AuditListQuery,
  type Paginated,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { CurrentOrg, type OrgContext } from '../../auth/org-context';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { AuditRepository, type AuditRow } from './audit.repository';

/**
 * Reads the trail. There is deliberately no way to write one from here, and no way to
 * delete: entries are written by `AuditService` inside the transaction that made the
 * change, and an audit log anybody can edit is not an audit log.
 */
@ApiTags('audit')
@ApiStandardErrors()
@Controller('audit')
export class AuditController {
  constructor(private readonly repository: AuditRepository) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'The activity of the active organization, newest first' })
  @ApiEnvelope(zPaginated(AuditEntrySchema))
  async list(
    @CurrentOrg() org: OrgContext,
    @Query({ schema: AuditListQuerySchema }) query: AuditListQuery,
  ): Promise<Paginated<AuditEntry>> {
    const filters = {
      action: query.action,
      actorUserId: query.actorUserId,
      resourceType: query.resourceType,
      from: query.from,
      to: query.to,
    };

    const [rows, total] = await Promise.all([
      this.repository.list(org, filters, {
        limit: query.size,
        offset: query.page * query.size,
      }),
      this.repository.countMatching(org, filters),
    ]);

    return {
      items: rows.map(toDto),
      meta: {
        page: query.page,
        size: query.size,
        total,
        totalPages: Math.ceil(total / query.size),
      },
    };
  }

  @Get('facets')
  @RequirePermissions(PERMISSIONS.AUDIT_READ)
  @ApiOperation({ summary: 'The actions present in this trail, for the filter' })
  @ApiEnvelope(AuditFacetsSchema)
  async facets(@CurrentOrg() org: OrgContext): Promise<AuditFacets> {
    return { actions: await this.repository.actions(org) };
  }
}

function toDto(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    action: row.action,
    createdAt: row.createdAt.toISOString(),
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorName: row.actorName,
    impersonatorUserId: row.impersonatorUserId,
    impersonatorEmail: row.impersonatorEmail,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    before: row.before ?? null,
    after: row.after ?? null,
    ip: row.ip,
    userAgent: row.userAgent,
    requestId: row.requestId,
    traceId: row.traceId,
  };
}
