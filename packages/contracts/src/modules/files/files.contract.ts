import { z } from 'zod';
import { PageQuerySchema } from '../../common/pagination';

export const FILE_STATUSES = ['pending', 'ready'] as const;
export type FileStatus = (typeof FILE_STATUSES)[number];

export const FileSchema = z.object({
  id: z.uuid(),
  organizationId: z.string().min(1),
  objectKey: z.string().min(1),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  status: z.enum(FILE_STATUSES),
  uploadedByUserId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type FileMetadata = z.infer<typeof FileSchema>;

/**
 * What the client declares before uploading.
 *
 * `size` is a declaration, not a measurement: it lets the API refuse an oversized
 * upload before handing out a URL, but the commit step re-reads the real size from
 * storage and refuses a mismatch. Never treat it as fact.
 */
export const FileUploadTicketRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
});
export type FileUploadTicketRequest = z.infer<typeof FileUploadTicketRequestSchema>;

/**
 * The upload ticket: a row in `pending` plus a presigned PUT the browser uses to send
 * the bytes straight to storage. The API never carries the payload.
 */
export const FileUploadTicketSchema = z.object({
  file: FileSchema,
  uploadUrl: z.url(),
  /** Headers the PUT must carry, or the signature will not match. */
  requiredHeaders: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export type FileUploadTicket = z.infer<typeof FileUploadTicketSchema>;

/** A short-lived presigned GET. Downloads never stream through the API — see CLAUDE.md. */
export const FileDownloadSchema = z.object({
  downloadUrl: z.url(),
  expiresAt: z.iso.datetime(),
});
export type FileDownload = z.infer<typeof FileDownloadSchema>;

export const FileListQuerySchema = PageQuerySchema.extend({
  status: z.enum(FILE_STATUSES).optional(),
});
export type FileListQuery = z.infer<typeof FileListQuerySchema>;
