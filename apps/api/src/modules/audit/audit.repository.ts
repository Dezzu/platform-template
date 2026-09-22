import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, count, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import { auditLog, user, type Database } from '@app/db';
import { TenantRepository, type OrgScope } from '../../database/tenant.repository';
import { DRIZZLE } from '../../database/database.module';

export interface AuditRow {
  id: string;
  action: string;
  createdAt: Date;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  impersonatorUserId: string | null;
  impersonatorEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  traceId: string | null;
}

export interface AuditFilters {
  action?: string | undefined;
  actorUserId?: string | undefined;
  resourceType?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Reads the trail for one organization.
 *
 * Through TenantRepository like every other org-scoped table, which also settles a
 * question the schema raises: `audit_log.organization_id` is nullable, because
 * platform actions belong to no tenant. The tenant predicate excludes those rows by
 * construction, so a customer never sees what an administrator did across tenants.
 */
@Injectable()
export class AuditRepository extends TenantRepository<typeof auditLog> {
  /** Left joins for the two people an entry can name. */
  private readonly actor = aliasedTable(user, 'actor');
  private readonly impersonator = aliasedTable(user, 'impersonator');

  constructor(@Inject(DRIZZLE) db: Database) {
    super(db, auditLog);
  }

  private where(scope: OrgScope, filters: AuditFilters): SQL {
    const extra: (SQL | undefined)[] = [
      filters.action ? eq(auditLog.action, filters.action) : undefined,
      filters.actorUserId ? eq(auditLog.actorUserId, filters.actorUserId) : undefined,
      filters.resourceType ? eq(auditLog.resourceType, filters.resourceType) : undefined,
      filters.from ? gte(auditLog.createdAt, new Date(filters.from)) : undefined,
      filters.to ? lt(auditLog.createdAt, new Date(filters.to)) : undefined,
    ];
    return this.scoped(scope, ...extra);
  }

  async list(
    scope: OrgScope,
    filters: AuditFilters,
    page: { limit: number; offset: number },
  ): Promise<AuditRow[]> {
    return (
      this.db
        .select({
          id: auditLog.id,
          action: auditLog.action,
          createdAt: auditLog.createdAt,
          actorUserId: auditLog.actorUserId,
          // The snapshot taken at write time wins: it survives the account being
          // deleted or anonymised, which the join does not.
          actorEmail: sql<string | null>`coalesce(${auditLog.actorEmail}, ${this.actor.email})`,
          actorName: this.actor.name,
          impersonatorUserId: auditLog.impersonatorUserId,
          impersonatorEmail: this.impersonator.email,
          resourceType: auditLog.resourceType,
          resourceId: auditLog.resourceId,
          before: auditLog.before,
          after: auditLog.after,
          ip: auditLog.ip,
          userAgent: auditLog.userAgent,
          requestId: auditLog.requestId,
          traceId: auditLog.traceId,
        })
        .from(auditLog)
        .leftJoin(this.actor, eq(auditLog.actorUserId, this.actor.id))
        .leftJoin(this.impersonator, eq(auditLog.impersonatorUserId, this.impersonator.id))
        .where(this.where(scope, filters))
        // Always newest first: a trail read from the oldest end answers no question
        // anybody actually has.
        .orderBy(desc(auditLog.createdAt))
        .limit(page.limit)
        .offset(page.offset)
    );
  }

  async countMatching(scope: OrgScope, filters: AuditFilters): Promise<number> {
    const rows = await this.db
      .select({ value: count() })
      .from(auditLog)
      .where(this.where(scope, filters));
    return Number(rows[0]?.value ?? 0);
  }

  /** The actions actually present in this tenant's trail, for the filter. */
  async actions(scope: OrgScope): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ action: auditLog.action })
      .from(auditLog)
      .where(this.scoped(scope))
      .orderBy(auditLog.action);
    return rows.map((row) => row.action);
  }
}
