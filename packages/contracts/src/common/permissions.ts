/**
 * The permission catalogue. Shared by the API (guards) and Angular (route guards and
 * the sidebar manifest) so the two can never disagree about who may do what.
 *
 * Naming: `<resource>.<action>`. `read` implies viewing, `manage` implies create and
 * update, destructive actions get their own permission.
 */
export const PERMISSIONS = {
  // Organization itself
  ORG_READ: 'org.read',
  ORG_MANAGE: 'org.manage',
  ORG_DELETE: 'org.delete',

  // Membership
  MEMBERS_READ: 'members.read',
  MEMBERS_INVITE: 'members.invite',
  MEMBERS_MANAGE: 'members.manage',
  MEMBERS_REMOVE: 'members.remove',

  // Billing
  BILLING_READ: 'billing.read',
  BILLING_MANAGE: 'billing.manage',

  // Settings
  SETTINGS_READ: 'settings.read',
  SETTINGS_MANAGE: 'settings.manage',

  // Audit
  AUDIT_READ: 'audit.read',

  // Privacy and data protection. Exporting an organization means exporting every
  // member's personal data along with it, which is why it is a permission of its own
  // rather than something `settings.manage` happens to cover.
  GDPR_EXPORT: 'gdpr.export',

  // Files
  FILES_READ: 'files.read',
  FILES_WRITE: 'files.write',
  FILES_DELETE: 'files.delete',

  // Reference domain feature — the template's worked example
  PROJECTS_READ: 'projects.read',
  PROJECTS_MANAGE: 'projects.manage',
  PROJECTS_DELETE: 'projects.delete',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Platform-level permissions. NOT organization-scoped: they come from `user.role`
 * (the Better Auth admin plugin), not from membership, and they cross tenant
 * boundaries — which is exactly why they are a separate namespace and a separate
 * decorator on the backend.
 */
export const PLATFORM_PERMISSIONS = {
  USERS_READ: 'platform.users.read',
  USERS_MANAGE: 'platform.users.manage',
  ORGANIZATIONS_READ: 'platform.organizations.read',
  ORGANIZATIONS_MANAGE: 'platform.organizations.manage',
  IMPERSONATE: 'platform.impersonate',
  METRICS_READ: 'platform.metrics.read',
  FLAGS_MANAGE: 'platform.flags.manage',
  MAINTENANCE_MANAGE: 'platform.maintenance.manage',
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

/**
 * How the organization roles rank against each other.
 *
 * Permissions say what you may do to *things*; rank says what you may do to *people*.
 * The two are different questions, and conflating them is how an admin — who legitimately
 * holds `members.remove` — ends up able to remove the owner and take the tenant over.
 *
 * The rule, enforced server-side: you may only act on a member whose rank is at or
 * below yours, and only grant a role at or below your own.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = { owner: 3, admin: 2, member: 1 };

export function outranksOrEquals(actor: OrgRole, target: OrgRole): boolean {
  return ORG_ROLE_RANK[actor] >= ORG_ROLE_RANK[target];
}

const P = PERMISSIONS;

/** Every read permission — the baseline a plain member gets. */
const ALL_READ: Permission[] = [
  P.ORG_READ,
  P.MEMBERS_READ,
  P.BILLING_READ,
  P.SETTINGS_READ,
  P.FILES_READ,
  P.PROJECTS_READ,
];

/**
 * Role to permission mapping.
 *
 * `admin` deliberately lacks ORG_DELETE and BILLING_MANAGE: deleting the tenant and
 * changing what the customer pays are owner decisions, and an admin who can do either
 * is an admin who can lock the owner out or run up their bill.
 */
export const ROLE_PERMISSIONS: Record<OrgRole, readonly Permission[]> = {
  owner: Object.values(P),
  admin: Object.values(P).filter(
    (p) => p !== P.ORG_DELETE && p !== P.BILLING_MANAGE,
  ) as Permission[],
  member: [...ALL_READ, P.FILES_WRITE],
};

export const PLATFORM_ROLES = ['user', 'admin', 'superadmin'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

/**
 * Rank among platform roles, for the same reason organizations have one: permissions
 * say what you may do to things, rank says what you may do to *people*.
 *
 * Without it `admin` and `superadmin` collapse into the same role — an admin who may
 * set anyone's role can set their own to superadmin, or somebody else's, and the
 * distinction lasts exactly as long as nobody tries.
 */
export const PLATFORM_ROLE_RANK: Record<PlatformRole, number> = {
  superadmin: 3,
  admin: 2,
  user: 1,
};

export function platformOutranksOrEquals(actor: string, target: string): boolean {
  const actorRank = PLATFORM_ROLE_RANK[actor as PlatformRole] ?? 0;
  const targetRank = PLATFORM_ROLE_RANK[target as PlatformRole] ?? 0;
  return actorRank >= targetRank;
}

/**
 * Platform roles come from `user.role`, not from membership.
 *
 * `admin` is the support role: it can see every account and every organization, change
 * ordinary roles, send a reset link, ban and unban. What it deliberately cannot do is
 * become somebody else (impersonation), change what the platform does for everyone
 * (flags, maintenance), or touch a superadmin — the three things whose blast radius is
 * the whole product rather than one customer.
 */
export const PLATFORM_ROLE_PERMISSIONS: Record<string, readonly PlatformPermission[]> = {
  superadmin: Object.values(PLATFORM_PERMISSIONS),
  admin: [
    PLATFORM_PERMISSIONS.USERS_READ,
    PLATFORM_PERMISSIONS.USERS_MANAGE,
    PLATFORM_PERMISSIONS.ORGANIZATIONS_READ,
    PLATFORM_PERMISSIONS.ORGANIZATIONS_MANAGE,
    PLATFORM_PERMISSIONS.METRICS_READ,
  ],
  user: [],
};

export function permissionsForRole(role: string): readonly Permission[] {
  return ROLE_PERMISSIONS[role as OrgRole] ?? [];
}

export function platformPermissionsForRole(
  role: string | null | undefined,
): readonly PlatformPermission[] {
  return PLATFORM_ROLE_PERMISSIONS[role ?? 'user'] ?? [];
}
