// Deep import on purpose: the '@app/contracts' barrel re-exports Zod schemas built
// at module top level, which bundlers cannot tree-shake, and this file is on the
// eager path. Importing the constants directly keeps Zod out of the initial bundle.
import { PERMISSIONS, PLATFORM_PERMISSIONS } from '@app/contracts/permissions';
import type { NavItem } from './nav.model';

/**
 * The blocks of the menu, in the order they appear.
 *
 * Grouping is not decoration: a flat list of seven entries makes the reader compare
 * "Progetti" with "Amministrazione" as if they were the same kind of thing. The
 * headings say what kind of thing each one is — what you work on, what the tenant is,
 * what the platform is — and the reader stops looking in the wrong block.
 */
export const NAV_SECTIONS: readonly { id: string; labelKey: string }[] = [
  { id: 'workspace', labelKey: 'nav.sections.workspace' },
  { id: 'organization', labelKey: 'nav.sections.organization' },
  { id: 'platform', labelKey: 'nav.sections.platform' },
];

/**
 * The application menu.
 *
 * Adding a feature means adding an entry here — it is a mandatory step of the
 * end-to-end checklist in CLAUDE.md, because a route guarded by permissions but
 * missing from the manifest is a page nobody can find.
 *
 * The converse is enforced by a test: an entry without a matching route is a dead
 * link, so entries arrive together with the screen they open, never before it.
 *
 * Order here is order on screen, within each section. The sections themselves are
 * ordered by NAV_SECTIONS.
 */
export const NAV_MANIFEST: readonly NavItem[] = [
  {
    // Above every heading: it is the product, not a part of it.
    id: 'dashboard',
    labelKey: 'nav.dashboard',
    icon: 'lucideLayoutDashboard',
    route: '/dashboard',
  },

  // ── What you work on ────────────────────────────────────────────────────────
  {
    id: 'projects',
    section: 'workspace',
    labelKey: 'nav.projects',
    icon: 'lucideFolderKanban',
    route: '/projects',
    permissions: [PERMISSIONS.PROJECTS_READ],
  },
  {
    id: 'files',
    section: 'workspace',
    labelKey: 'nav.files',
    icon: 'lucideFolderOpen',
    route: '/files',
    permissions: [PERMISSIONS.FILES_READ],
  },
  {
    id: 'insights',
    section: 'workspace',
    labelKey: 'nav.insights',
    icon: 'lucideChartNoAxesColumn',
    route: '/insights',
    permissions: [PERMISSIONS.PROJECTS_READ],
    requiresSubscription: true,
  },

  // ── The tenant itself: who is in it, and what it costs ──────────────────────
  {
    /**
     * B2B only. In a personal product there is nobody to invite: the organization
     * exists to isolate data, and showing its membership would expose the plumbing.
     * The permission and the API stay — turning the screen back on is this one line.
     */
    id: 'members',
    section: 'organization',
    modes: ['b2b'],
    labelKey: 'nav.members',
    icon: 'lucideUsers',
    route: '/members',
    permissions: [PERMISSIONS.MEMBERS_READ],
  },
  {
    /**
     * Not gated on a mode: a personal product has a trail too — "what did I do to this
     * file" is a question one person asks about their own account just as often.
     */
    id: 'audit',
    section: 'organization',
    labelKey: 'nav.audit',
    icon: 'lucideScrollText',
    route: '/audit',
    permissions: [PERMISSIONS.AUDIT_READ],
  },
  {
    id: 'billing',
    section: 'organization',
    labelKey: 'nav.billing',
    icon: 'lucideCreditCard',
    route: '/billing',
    permissions: [PERMISSIONS.BILLING_READ],
  },

  // ── The platform's own back office, not part of the tenant's product ────────
  {
    id: 'admin',
    section: 'platform',
    labelKey: 'nav.admin',
    icon: 'lucideShieldCheck',
    route: '/admin/users',
    platformPermissions: [PLATFORM_PERMISSIONS.USERS_READ],
  },
  {
    /**
     * Its own entry for the same reason as the others here: `platform.metrics.read` is
     * held by a support admin too, who has neither flags nor maintenance. One "Admin"
     * link covering five screens would open on whichever one that person happens not
     * to be allowed to see.
     */
    id: 'admin-metrics',
    section: 'platform',
    labelKey: 'metrics.title',
    icon: 'lucideChartLine',
    route: '/admin/metrics',
    platformPermissions: [PLATFORM_PERMISSIONS.METRICS_READ],
  },
  {
    /**
     * Its own entry rather than a tab inside the administration area: a support admin
     * holds `platform.users.read` and none of this, and an entry they can see but not
     * open is worse than no entry at all.
     */
    id: 'admin-flags',
    section: 'platform',
    labelKey: 'nav.flags',
    icon: 'lucideFlag',
    route: '/admin/flags',
    platformPermissions: [PLATFORM_PERMISSIONS.FLAGS_MANAGE],
  },
  {
    id: 'admin-maintenance',
    section: 'platform',
    labelKey: 'nav.maintenance',
    icon: 'lucideHardHat',
    route: '/admin/maintenance',
    platformPermissions: [PLATFORM_PERMISSIONS.MAINTENANCE_MANAGE],
  },
];

/** Looks up an entry by id, including nested children. */
export function findNavItem(id: string, items: readonly NavItem[] = NAV_MANIFEST): NavItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    const child = item.children ? findNavItem(id, item.children) : null;
    if (child) return child;
  }
  return null;
}
