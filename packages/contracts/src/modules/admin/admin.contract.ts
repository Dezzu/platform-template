import { z } from 'zod';
import { ORG_ROLES, PLATFORM_ROLES } from '../../common/permissions';
import { PageQuerySchema } from '../../common/pagination';

/**
 * The platform administration surface: every account and every organization, across
 * tenants.
 *
 * This is the one part of the API that deliberately ignores the tenancy boundary the
 * rest of the system is built to enforce — which is exactly why it hangs off
 * `platform.*` permissions, resolved from `user.role` rather than from membership, and
 * why every mutation here is audited with a null organization.
 */

export const AdminUserSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  /** Platform role. Null means the account predates the admin plugin's default. */
  role: z.string().nullable(),
  banned: z.boolean(),
  banReason: z.string().nullable(),
  banExpires: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  /** How many organizations the account belongs to. */
  organizationCount: z.number().int().nonnegative(),
  /**
   * The role this account holds in the organization the list was filtered by.
   *
   * Null whenever the list is not scoped to one — "member of what?" has no answer
   * across tenants, and a column that is sometimes meaningless is worse than one that
   * is explicitly absent.
   */
  organizationRole: z.enum(ORG_ROLES).nullable(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUserListQuerySchema = PageQuerySchema.extend({
  role: z.enum(PLATFORM_ROLES).optional(),
  banned: z.stringbool().optional(),
  /**
   * Narrows the list to the members of one organization.
   *
   * Safe to take from the client here, unlike everywhere else in the API: this
   * endpoint is already platform-scoped and the caller has been granted the right to
   * see every tenant. It is a filter, not a tenancy decision.
   */
  organizationId: z.string().min(1).optional(),
});
export type AdminUserListQuery = z.infer<typeof AdminUserListQuerySchema>;

/** One account with the organizations it belongs to. */
export const AdminUserDetailSchema = AdminUserSchema.extend({
  organizations: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string(),
      slug: z.string().nullable(),
      role: z.enum(ORG_ROLES),
    }),
  ),
  activeSessions: z.number().int().nonnegative(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetailSchema>;

export const AdminRoleUpdateSchema = z.object({
  role: z.enum(PLATFORM_ROLES),
});
export type AdminRoleUpdate = z.infer<typeof AdminRoleUpdateSchema>;

/** Changing a member's role inside an organization, from outside that organization. */
export const AdminOrgRoleUpdateSchema = z.object({
  role: z.enum(ORG_ROLES),
});
export type AdminOrgRoleUpdate = z.infer<typeof AdminOrgRoleUpdateSchema>;

export const AdminBanSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  /** Absent means indefinite. */
  expiresAt: z.iso.datetime().optional(),
});
export type AdminBan = z.infer<typeof AdminBanSchema>;

export const AdminOrganizationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string().nullable(),
  logo: z.string().nullable(),
  createdAt: z.iso.datetime(),
  memberCount: z.number().int().nonnegative(),
  /** The plan it is on, or null when it has never subscribed. */
  subscription: z
    .object({
      plan: z.string(),
      status: z.string(),
      periodEnd: z.iso.datetime().nullable(),
    })
    .nullable(),
});
export type AdminOrganization = z.infer<typeof AdminOrganizationSchema>;

export const AdminOrganizationListQuerySchema = PageQuerySchema;
export type AdminOrganizationListQuery = z.infer<typeof AdminOrganizationListQuerySchema>;

export const AdminOrganizationDetailSchema = AdminOrganizationSchema.extend({
  members: z.array(
    z.object({
      id: z.string().min(1),
      role: z.enum(ORG_ROLES),
      user: z.object({
        id: z.string().min(1),
        name: z.string(),
        email: z.email(),
      }),
    }),
  ),
});
export type AdminOrganizationDetail = z.infer<typeof AdminOrganizationDetailSchema>;
