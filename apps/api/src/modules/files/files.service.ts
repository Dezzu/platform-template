import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { and, asc, desc, eq, inArray, isNull, lt, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type FileDownload,
  type FileListQuery,
  type FileMetadata,
  type FileUploadTicket,
  type FileUploadTicketRequest,
  type Paginated,
} from '@app/contracts';
import { file as fileTable, type Database } from '@app/db';
import { AppException } from '../../common';
import { storageConfig } from '../../config/namespaces';
import { DRIZZLE } from '../../database/database.module';
import { S3Service } from '../../storage/s3.service';
import { buildObjectKey } from '../../storage/object-key';
import { AuditService } from '../audit/audit.service';
import type { OrgContext } from '../../auth/org-context';
import { FilesRepository } from './files.repository';

type FileRow = typeof fileTable.$inferSelect;

/**
 * Uploads in two steps, because the bytes must not pass through this process.
 *
 *   ticket → the browser PUTs straight to storage → commit
 *
 * Only the commit is trusted. Everything the client said at ticket time — the size,
 * the content type — is re-read from the stored object and compared, because between
 * those two calls the client had a signed URL and could have sent anything the
 * signature allowed.
 */
@Injectable()
export class FilesService {
  constructor(
    private readonly repository: FilesRepository,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(storageConfig.KEY) private readonly config: ConfigType<typeof storageConfig>,
  ) {}

  /** Soft-deleted rows are invisible to every read path. */
  private readonly visible = isNull(fileTable.deletedAt);

  async list(ctx: OrgContext, query: FileListQuery): Promise<Paginated<FileMetadata>> {
    const filters: (SQL | undefined)[] = [
      this.visible,
      query.status ? eq(fileTable.status, query.status) : undefined,
    ];
    const where = and(...filters.filter((f): f is SQL => f !== undefined));

    const column = query.sort === 'fileName' ? fileTable.fileName : fileTable.createdAt;
    const orderBy = query.dir === 'asc' ? asc(column) : desc(column);

    const [rows, total] = await Promise.all([
      this.repository.findMany(ctx, {
        ...(where ? { where } : {}),
        orderBy,
        limit: query.size,
        offset: query.page * query.size,
      }),
      this.repository.count(ctx, where),
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

  /**
   * Issues the upload ticket: a `pending` row plus a presigned PUT.
   *
   * Both limits are checked here so an oversized or forbidden upload is refused
   * *before* a URL exists — once one is issued it is valid for its whole lifetime, and
   * a client that already has it cannot be told "no" any more.
   */
  async createUploadTicket(
    ctx: OrgContext,
    input: FileUploadTicketRequest,
  ): Promise<FileUploadTicket> {
    this.assertAllowedType(input.contentType);
    if (input.size > this.config.maxUploadBytes) {
      throw new AppException(
        ERROR_CODES.FILE_TOO_LARGE,
        413,
        `File exceeds the ${this.config.maxUploadBytes} byte limit`,
        { maxBytes: this.config.maxUploadBytes },
      );
    }

    const objectKey = buildObjectKey({
      organizationId: ctx.organizationId,
      fileName: input.fileName,
    });

    const row = await this.repository.insert(ctx, {
      objectKey,
      fileName: input.fileName,
      contentType: input.contentType,
      size: input.size,
      status: 'pending',
      uploadedByUserId: ctx.userId,
    });

    const presigned = await this.s3.presignPut(objectKey, input.contentType);

    return {
      file: toDto(row),
      uploadUrl: presigned.url,
      // Signed, so the PUT must carry it verbatim or storage answers 403.
      requiredHeaders: { 'Content-Type': input.contentType },
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  /**
   * Confirms the upload landed, and is the only step that believes storage over the
   * client. A row stays `pending` — and therefore invisible and sweepable — until this
   * succeeds.
   */
  async commit(ctx: OrgContext, id: string): Promise<FileMetadata> {
    const row = await this.repository.findById(ctx, id);
    if (!row || row.deletedAt) throw AppException.notFound('File');
    if (row.status === 'ready') return toDto(row);

    const head = await this.s3.head(row.objectKey);
    if (!head) {
      throw new AppException(
        ERROR_CODES.FILE_NOT_UPLOADED,
        409,
        'No object exists at that key — the upload never completed',
      );
    }

    // The signed Content-Type is enforced by storage itself; size is not signed, so
    // this is where an oversized upload is actually caught.
    if (head.size > this.config.maxUploadBytes) {
      await this.s3.delete(row.objectKey);
      await this.db.delete(fileTable).where(eq(fileTable.id, row.id));
      throw new AppException(
        ERROR_CODES.FILE_TOO_LARGE,
        413,
        `Uploaded object is ${head.size} bytes, over the ${this.config.maxUploadBytes} byte limit`,
        { maxBytes: this.config.maxUploadBytes, actualBytes: head.size },
      );
    }

    if (head.contentType && head.contentType !== row.contentType) {
      throw new AppException(
        ERROR_CODES.FILE_UPLOAD_MISMATCH,
        409,
        `Stored object is ${head.contentType}, the ticket declared ${row.contentType}`,
      );
    }

    return this.db.transaction(async (tx) => {
      const updated = await this.repository.update(
        ctx,
        id,
        {
          status: 'ready',
          size: head.size,
          etag: head.etag ?? null,
          updatedAt: new Date(),
        },
        tx,
      );
      if (!updated) throw AppException.notFound('File');

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          impersonatorUserId: ctx.impersonatorUserId,
          action: 'file.uploaded',
          resourceType: 'file',
          resourceId: id,
          after: toDto(updated),
        },
        tx,
      );

      return toDto(updated);
    });
  }

  /**
   * A short-lived presigned GET.
   *
   * Never a redirect through the API and never a proxied stream: see the rule in
   * CLAUDE.md about header-signed requests behind Cloudflare.
   */
  async download(ctx: OrgContext, id: string): Promise<FileDownload> {
    const row = await this.repository.findById(ctx, id);
    if (!row || row.deletedAt) throw AppException.notFound('File');
    if (row.status !== 'ready') {
      throw new AppException(
        ERROR_CODES.FILE_NOT_READY,
        409,
        'The upload has not been committed yet',
      );
    }

    const presigned = await this.s3.presignGet(row.objectKey, row.fileName);
    return { downloadUrl: presigned.url, expiresAt: presigned.expiresAt.toISOString() };
  }

  /**
   * Soft delete, then remove the object.
   *
   * In that order: a row marked deleted whose object still exists is invisible and
   * costs storage, while an object deleted before the row is committed would leave a
   * visible file that 404s on download. The janitor collects the first case.
   */
  async remove(ctx: OrgContext, id: string): Promise<void> {
    const row = await this.db.transaction(async (tx) => {
      const existing = await this.repository.findById(ctx, id, tx);
      if (!existing || existing.deletedAt) throw AppException.notFound('File');

      const updated = await this.repository.update(
        ctx,
        id,
        { deletedAt: new Date(), updatedAt: new Date() },
        tx,
      );
      if (!updated) throw AppException.notFound('File');

      await this.audit.record(
        {
          organizationId: ctx.organizationId,
          actorUserId: ctx.userId,
          impersonatorUserId: ctx.impersonatorUserId,
          action: 'file.deleted',
          resourceType: 'file',
          resourceId: id,
          before: toDto(existing),
        },
        tx,
      );

      return updated;
    });

    await this.s3.delete(row.objectKey);
  }

  /**
   * Removes uploads that were reserved and never committed.
   *
   * This is the price of not proxying the bytes: the API hands out a URL and then has
   * no idea whether the browser finished. Some fraction of tickets are abandoned — a
   * closed tab, a dropped connection — and each one leaves a row nobody can see and
   * possibly an object nobody can reach.
   *
   * Deliberately NOT tenant-scoped, which is why it goes through `this.db` rather than
   * the repository: it is a platform-wide sweep with no request and no OrgContext, and
   * pretending otherwise would mean iterating every organization to do one query.
   * Called only from the maintenance queue.
   */
  async sweepAbandonedUploads(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - this.config.pendingTtlHours * 3_600_000);

    const abandoned = await this.db
      .select({ id: fileTable.id, objectKey: fileTable.objectKey })
      .from(fileTable)
      .where(and(eq(fileTable.status, 'pending'), lt(fileTable.createdAt, cutoff)))
      .limit(1_000);

    if (abandoned.length === 0) return 0;

    // Rows first: a row whose object is already gone is a visible file that 404s, which
    // is worse than an orphaned object the next sweep cannot see. Hard delete, not soft
    // — a pending row was never a file anyone knew about.
    await this.db.delete(fileTable).where(
      inArray(
        fileTable.id,
        abandoned.map((row) => row.id),
      ),
    );
    await this.s3.deleteMany(abandoned.map((row) => row.objectKey));

    return abandoned.length;
  }

  private assertAllowedType(contentType: string): void {
    const allowed = this.config.allowedMimeTypes;
    if (allowed.length === 0) return;
    if (allowed.includes(contentType)) return;

    throw new AppException(
      ERROR_CODES.FILE_TYPE_NOT_ALLOWED,
      415,
      `Content type "${contentType}" is not allowed`,
      { allowed },
    );
  }
}

function toDto(row: FileRow): FileMetadata {
  return {
    id: row.id,
    organizationId: row.organizationId,
    objectKey: row.objectKey,
    fileName: row.fileName,
    contentType: row.contentType,
    size: row.size,
    status: row.status,
    uploadedByUserId: row.uploadedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
