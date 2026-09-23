import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, desc, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import {
  ERROR_CODES,
  PERMISSIONS,
  permissionsForRole,
  type GdprExportDownload,
  type GdprExportRequest,
  type GdprExportScope,
} from '@app/contracts';
import { gdprExportRequest, member, user, type Database } from '@app/db';
import { AppException } from '../../common';
import { appConfig, gdprConfig } from '../../config/namespaces';
import { DRIZZLE } from '../../database/database.module';
import { JOBS, QUEUES } from '../../queue/queue.constants';
import { S3Service } from '../../storage/s3.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildArchive, collectOrganizationData, collectUserData } from './gdpr-collect';

type ExportRow = typeof gdprExportRequest.$inferSelect;

/** Requesting, building and handing over a copy of somebody's data. */
@Injectable()
export class GdprExportService {
  private readonly logger = new Logger(GdprExportService.name);

  constructor(
    @InjectQueue(QUEUES.GDPR) private readonly queue: Queue,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(gdprConfig.KEY) private readonly config: ConfigType<typeof gdprConfig>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  /**
   * Records the request and hands the work to the queue.
   *
   * Nothing is read here. An export walks a dozen tables and uploads the result, which
   * is minutes of work on a large tenant — doing it inline would be a request the
   * caller waits on and a gateway timeout the moment it is worth waiting for.
   */
  async request(
    userId: string,
    scope: GdprExportScope,
    organizationId: string | null,
  ): Promise<GdprExportRequest> {
    // One at a time per subject. A second press would queue the same work against the
    // same data and produce a second archive nobody asked for.
    const [open] = await this.db
      .select({ id: gdprExportRequest.id })
      .from(gdprExportRequest)
      .where(
        and(
          eq(gdprExportRequest.userId, userId),
          eq(gdprExportRequest.scope, scope),
          inArray(gdprExportRequest.status, ['pending', 'processing']),
        ),
      )
      .limit(1);

    if (open) {
      throw AppException.conflict(
        'An export is already being prepared',
        ERROR_CODES.GDPR_EXPORT_IN_PROGRESS,
      );
    }

    const [row] = await this.db
      .insert(gdprExportRequest)
      .values({ userId, scope, organizationId: scope === 'organization' ? organizationId : null })
      .returning();

    if (!row) throw new Error('failed to record the export request');

    await this.queue.add(JOBS.GDPR_EXPORT, { requestId: row.id });

    await this.audit.record({
      organizationId: scope === 'organization' ? organizationId : null,
      actorUserId: userId,
      action: 'gdpr.export_requested',
      resourceType: 'gdpr_export_request',
      resourceId: row.id,
      after: { scope },
    });

    return toDto(row);
  }

  /** The caller's own requests, both scopes, newest first. */
  async listMine(userId: string): Promise<GdprExportRequest[]> {
    const rows = await this.db
      .select()
      .from(gdprExportRequest)
      .where(eq(gdprExportRequest.userId, userId))
      .orderBy(desc(gdprExportRequest.createdAt))
      .limit(20);

    return rows.map(toDto);
  }

  /**
   * A short-lived presigned GET.
   *
   * Two checks, not one. The row must be the caller's — which alone would be enough
   * for a personal export — and for an organization export the caller must *still*
   * hold `gdpr.export` in that tenant. Somebody who asked for their employer's data
   * and then left must not keep a working download of it.
   */
  async download(userId: string, id: string): Promise<GdprExportDownload> {
    const [row] = await this.db
      .select()
      .from(gdprExportRequest)
      .where(and(eq(gdprExportRequest.id, id), eq(gdprExportRequest.userId, userId)))
      .limit(1);

    // Somebody else's request is indistinguishable from a missing one: a 403 would
    // confirm the id exists.
    if (!row) throw AppException.notFound('Export request');

    if (row.scope === 'organization') await this.assertStillEntitled(userId, row.organizationId);

    if (row.status === 'expired') {
      throw new AppException(
        ERROR_CODES.GDPR_EXPORT_EXPIRED,
        HttpStatus.GONE,
        'That archive has been deleted — ask for a new export',
      );
    }
    if (row.status !== 'ready' || !row.objectKey) {
      throw new AppException(
        ERROR_CODES.GDPR_EXPORT_NOT_READY,
        HttpStatus.CONFLICT,
        'The archive is still being prepared',
      );
    }
    // Belt and braces: the sweep runs on a schedule, so between the moment an archive
    // expires and the moment it is swept the row still says `ready`.
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      throw new AppException(
        ERROR_CODES.GDPR_EXPORT_EXPIRED,
        HttpStatus.GONE,
        'That archive has expired — ask for a new export',
      );
    }

    const presigned = await this.s3.presignGet(row.objectKey, `export-${row.scope}.json`);

    await this.audit.record({
      organizationId: row.organizationId,
      actorUserId: userId,
      action: 'gdpr.export_downloaded',
      resourceType: 'gdpr_export_request',
      resourceId: row.id,
    });

    return { url: presigned.url, expiresAt: presigned.expiresAt.toISOString() };
  }

  private async assertStillEntitled(userId: string, organizationId: string | null): Promise<void> {
    if (!organizationId) throw AppException.notFound('Export request');

    const [membership] = await this.db
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1);

    if (!membership || !permissionsForRole(membership.role).includes(PERMISSIONS.GDPR_EXPORT)) {
      throw AppException.missingPermission([PERMISSIONS.GDPR_EXPORT]);
    }
  }

  // ── The worker's half ──────────────────────────────────────────────────────

  /**
   * Builds one archive. Called from the queue, never from a handler.
   *
   * A failure is recorded on the row rather than only thrown: the screen has to be
   * able to say "this one failed" instead of showing a request stuck at `processing`
   * forever, which is indistinguishable from a worker that is simply slow.
   */
  async run(requestId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(gdprExportRequest)
      .where(eq(gdprExportRequest.id, requestId))
      .limit(1);

    if (!row) {
      this.logger.warn(`export request ${requestId} no longer exists — nothing to build`);
      return;
    }
    if (row.status !== 'pending') {
      // A retry after the archive was already written, or a cancelled request.
      this.logger.log(`export request ${requestId} is ${row.status} — skipping`);
      return;
    }

    await this.db
      .update(gdprExportRequest)
      .set({ status: 'processing', updatedAt: new Date() })
      .where(eq(gdprExportRequest.id, requestId));

    try {
      const subjectId = row.scope === 'user' ? row.userId : (row.organizationId ?? '');
      if (!subjectId) throw new Error('an organization export without an organization');

      const data =
        row.scope === 'user'
          ? await collectUserData(this.db, row.userId)
          : await collectOrganizationData(this.db, subjectId);

      const archive = buildArchive({
        scope: row.scope,
        subjectId,
        application: this.app.name,
        data,
      });

      const objectKey = buildExportKey(subjectId, row.id);
      const sizeBytes = await this.s3.put(
        objectKey,
        JSON.stringify(archive, null, 2),
        'application/json',
      );

      const expiresAt = new Date(Date.now() + this.config.exportTtlHours * 3_600_000);

      await this.db
        .update(gdprExportRequest)
        .set({
          status: 'ready',
          objectKey,
          sizeBytes,
          expiresAt,
          error: null,
          updatedAt: new Date(),
        })
        .where(eq(gdprExportRequest.id, requestId));

      await this.notifyReady(row, expiresAt);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(gdprExportRequest)
        .set({ status: 'failed', error: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(gdprExportRequest.id, requestId));
      throw error;
    }
  }

  /**
   * Tells the requester it is ready — through the notification centre, so the reader's
   * own preferences decide where it lands.
   *
   * Raised rather than emailed directly: this is the only announcement the product
   * makes about an export, and a feature sending its own mail is a feature the
   * preferences screen cannot describe. The email channel is marked `mandatory` in the
   * registry, so it goes out whatever the switch says — an archive expires, and
   * somebody who never learned it was ready has been ignored rather than served.
   *
   * **The link is not in it.** A presigned URL in an inbox is the archive itself,
   * forwardable and searchable for as long as the mail lives. Both halves point at the
   * screen; the screen mints a fresh URL behind the session that asked for it.
   *
   * `organizationId` is null for a personal export, and that is what makes the in-app
   * half visible wherever the person happens to be working — see the notification
   * table's comment on why that column is nullable.
   */
  private async notifyReady(row: ExportRow, expiresAt: Date): Promise<void> {
    try {
      const [recipient] = await this.db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, row.userId))
        .limit(1);

      if (!recipient) return;

      const privacyUrl = `${this.app.dashboardUrl}/privacy`;

      await this.notifications.notify({
        organizationId: row.organizationId,
        userIds: [row.userId],
        type: 'gdpr.export_ready',
        // Keys and placeholders, never a rendered sentence: the reader can change
        // language, and an archive announced in Italian would stay Italian forever.
        params: { scope: row.scope, expiresAt: expiresAt.toISOString() },
        actionUrl: '/privacy',
        email: {
          name: recipient.name,
          scope: row.scope,
          expiresAt: expiresAt.toISOString(),
          privacyUrl,
        },
      });
    } catch (error: unknown) {
      // The archive exists; failing to announce it must not fail the job and lose it.
      this.logger.error(
        `export ${row.id} is ready but the notification failed`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * Deletes the archives whose retention window has passed, and marks their rows.
   *
   * The row survives the object on purpose: "who asked for a copy of what, and when"
   * is itself a question a data protection officer gets asked, and it is answered by
   * a row that says `expired` rather than by a gap.
   */
  async sweepExpired(): Promise<number> {
    const due = await this.db
      .select({ id: gdprExportRequest.id, objectKey: gdprExportRequest.objectKey })
      .from(gdprExportRequest)
      .where(
        and(
          eq(gdprExportRequest.status, 'ready'),
          isNotNull(gdprExportRequest.expiresAt),
          lt(gdprExportRequest.expiresAt, new Date()),
        ),
      );

    if (due.length === 0) return 0;

    await this.s3.deleteMany(due.map((row) => row.objectKey).filter((key): key is string => !!key));

    await this.db
      .update(gdprExportRequest)
      .set({ status: 'expired', objectKey: null, sizeBytes: null, updatedAt: new Date() })
      .where(
        inArray(
          gdprExportRequest.id,
          due.map((row) => row.id),
        ),
      );

    return due.length;
  }

  /** Every archive belonging to a subject about to be erased, so the objects go too. */
  async objectKeysFor(where: { userId?: string; organizationId?: string }): Promise<string[]> {
    const predicate = where.userId
      ? eq(gdprExportRequest.userId, where.userId)
      : eq(gdprExportRequest.organizationId, where.organizationId ?? '');

    const rows = await this.db
      .select({ objectKey: gdprExportRequest.objectKey })
      .from(gdprExportRequest)
      .where(and(predicate, isNotNull(gdprExportRequest.objectKey)));

    return rows.map((row) => row.objectKey).filter((key): key is string => !!key);
  }
}

/**
 * `exports/{subjectId}/{yyyy}/{mm}/{uuid}.json`.
 *
 * Its own prefix rather than the tenant-led one uploads use: a personal export belongs
 * to no tenant, and putting archives under a customer's prefix would make a per-prefix
 * storage policy written for their files apply to somebody's article 15 request too.
 */
function buildExportKey(subjectId: string, requestId: string): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  // The request id is already unique; the extra UUID makes the key unguessable, which
  // matters for an object whose whole content is personal data.
  return `exports/${subjectId}/${year}/${month}/${requestId}-${randomUUID()}.json`;
}

function toDto(row: ExportRow): GdprExportRequest {
  const live = row.status === 'ready' && (!row.expiresAt || row.expiresAt.getTime() > Date.now());

  return {
    id: row.id,
    scope: row.scope,
    status: row.status,
    sizeBytes: row.sizeBytes,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    downloadable: live,
  };
}
