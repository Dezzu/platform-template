import type { Permission, PlatformPermission } from '@app/contracts';

/**
 * One entry of the application menu.
 *
 * This is the single source for both the sidebar and the router guards. Two consumers,
 * one declaration — which is what makes it impossible for the menu to offer a link the
 * router will refuse, or to hide one the user could actually reach.
 */
export interface NavItem {
  /** Stable id; routes reference it through `navGuard(id)`. */
  id: string;
  /**
   * Which block of the menu this belongs to, by id — see NAV_SECTIONS.
   *
   * Absent means the top of the list, above every heading: for the one or two entries
   * that are the product itself rather than a part of it.
   */
  section?: string;
  /** i18n key, never a display string. */
  labelKey: string;
  /** ng-icon name, e.g. 'lucideFolder'. */
  icon: string;
  /** Router link. */
  route: string;
  /** Permissions required to see and to enter. Empty means "any signed-in user". */
  permissions?: readonly Permission[];
  /**
   * Platform permissions required instead.
   *
   * A separate field rather than more entries in `permissions`, for the same reason the
   * backend has a separate decorator: these come from `user.role` and cross tenant
   * boundaries, and an entry that mixed the two would be one typo away from showing the
   * platform administration area to an organization admin.
   */
  platformPermissions?: readonly PlatformPermission[];
  /** How to combine them. Defaults to 'any'. */
  mode?: 'any' | 'all';
  /** Hidden and unreachable while the flag is off. */
  featureFlag?: string;
  /**
   * The screen behind this entry needs a paid subscription.
   *
   * The entry stays visible without one — hiding it means nobody discovers the
   * feature and nobody upgrades — and the page shows what it offers plus a way to
   * subscribe. The API answers 402 either way.
   */
  requiresSubscription?: boolean;
  children?: readonly NavItem[];
}
