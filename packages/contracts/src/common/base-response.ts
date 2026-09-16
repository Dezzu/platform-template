import { z } from 'zod';
import { ERROR_CODES, type ErrorCode } from './error-codes';

/**
 * Every response — success and failure alike — is wrapped in this envelope.
 *
 * Important: the envelope is NOT an excuse to answer 200 on failure. Errors keep
 * their real HTTP status (400/401/403/404/409/422/429/500); the envelope only
 * guarantees a consistent shape and, crucially, a stable `messageCode` the client
 * can translate.
 */
export interface BaseResponse<T> {
  success: boolean;
  /** Developer-facing English text. Never shown to end users — translate the code. */
  message: string | null;
  /** Stable code the client maps to a translated string. Null on success. */
  messageCode: ErrorCode | null;
  data: T | null;
}

/** Wraps a payload schema in the envelope, for OpenAPI generation. */
export const zBaseResponse = <T extends z.ZodType>(data: T) =>
  z.object({
    success: z.boolean(),
    message: z.string().nullable(),
    messageCode: z.enum(Object.values(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]).nullable(),
    data: data.nullable(),
  });

/** Page metadata returned alongside any list endpoint. */
export const PageMetaSchema = z.object({
  page: z.int().nonnegative(),
  size: z.int().positive(),
  total: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

/** Wraps a list payload in the envelope. */
export const zPaginated = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), meta: PageMetaSchema });
