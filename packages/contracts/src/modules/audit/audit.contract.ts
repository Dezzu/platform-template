import { z } from 'zod';
import { PageQuerySchema } from '../../common/pagination';

/**
 * One entry of the append-only trail. Written by `AuditService` on every mutation,
 * inside the same transaction as the change it describes.
 */
export const AuditEntrySchema = z.object({
  id: z.uuid(),
  /** `verb.noun`, e.g. 'project.created'. An open set: features add to it. */
  action: z.string().min(1),
  createdAt: z.iso.datetime(),

  /**
   * Who did it. Null once the account is deleted — which is why `actorEmail` exists
   * alongside: a trail that becomes unreadable is useless exactly when it is needed.
   */
  actorUserId: z.string().nullable(),
  actorEmail: z.string().nullable(),
  actorName: z.string().nullable(),

  /** Set when a platform administrator did this while impersonating the actor. */
  impersonatorUserId: z.string().nullable(),
  impersonatorEmail: z.string().nullable(),

  resourceType: z.string().nullable(),
  resourceId: z.string().nullable(),

  /**
   * The change itself. Shown only when a row is opened: a diff in a table cell is
   * noise in every row that nobody wanted to read.
   */
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),

  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** Links the entry to the request, and later to the distributed trace. */
  requestId: z.string().nullable(),
  traceId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditListQuerySchema = PageQuerySchema.extend({
  /** Exact action, as recorded. The screen offers the ones actually present. */
  action: z.string().min(1).optional(),
  actorUserId: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  /** Inclusive lower bound, as an ISO date. */
  from: z.iso.datetime().optional(),
  /** Exclusive upper bound. */
  to: z.iso.datetime().optional(),
});
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

/**
 * The distinct actions present in the trail, for the filter.
 *
 * Read from the data rather than from a constant: the set grows with every feature,
 * and a hard-coded list would offer filters that match nothing and miss the ones that
 * do.
 */
export const AuditFacetsSchema = z.object({
  actions: z.array(z.string()),
});
export type AuditFacets = z.infer<typeof AuditFacetsSchema>;
