import { Inject, Injectable, Logger } from '@nestjs/common';
import { auditLog, type Database, type DbOrTx } from '@app/db';
import { DRIZZLE } from '../../database/database.module';
import { currentRequestContext } from '../../common/request-context';

export interface AuditEntry {
  /** Null only for platform-level actions that belong to no tenant. */
  organizationId: string | null;
  actorUserId: string | null;
  actorEmail?: string | null;
  impersonatorUserId?: string | null;
  /** `verb.noun`, e.g. 'project.created'. Keep the vocabulary small and consistent. */
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Writes one audit entry. Pass `tx` to record it in the same transaction as the
   * change it describes — otherwise a rolled-back mutation leaves an entry claiming
   * something happened that did not.
   *
   * Origin metadata (ip, user agent, request id) comes from the ambient request
   * context rather than the call site, so it cannot be forgotten.
   */
  async record(entry: AuditEntry, tx?: DbOrTx): Promise<void> {
    const ctx = currentRequestContext();

    try {
      await (tx ?? this.db).insert(auditLog).values({
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        actorEmail: entry.actorEmail ?? null,
        impersonatorUserId: entry.impersonatorUserId ?? null,
        action: entry.action,
        resourceType: entry.resourceType ?? null,
        resourceId: entry.resourceId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
        requestId: ctx?.requestId ?? null,
        traceId: ctx?.traceId ?? null,
      });
    } catch (error: unknown) {
      // Outside a transaction, a failed audit write must not fail the user's request:
      // losing the trail is bad, refusing the operation because of it is worse. Inside
      // a transaction the caller passes `tx` and the error propagates as it should.
      if (tx) throw error;
      this.logger.error(
        `failed to record audit entry '${entry.action}'`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
