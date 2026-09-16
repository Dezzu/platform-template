import { z } from 'zod';
import { PageQuerySchema } from '../../common/pagination';

/**
 * The template's worked example of a feature contract. When adding a real feature,
 * copy this file's shape — see the end-to-end checklist in CLAUDE.md.
 */

export const PROJECT_STATUSES = ['active', 'archived'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const ProjectSchema = z.object({
  id: z.uuid(),
  organizationId: z.string().min(1),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable(),
  status: z.enum(PROJECT_STATUSES),
  createdByUserId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;

/**
 * Note what is absent: organizationId. The tenant is taken from the authenticated
 * context, never from the payload — accepting it here would be a cross-tenant write
 * waiting to happen.
 */
export const ProjectCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = ProjectCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'at least one field is required' },
);
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export const ProjectListQuerySchema = PageQuerySchema.extend({
  status: z.enum(PROJECT_STATUSES).optional(),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;
