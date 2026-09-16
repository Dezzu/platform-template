import type { Permission } from '@app/contracts';

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
  /** i18n key, never a display string. */
  labelKey: string;
  /** ng-icon name, e.g. 'lucideFolder'. */
  icon: string;
  /** Router link. */
  route: string;
  /** Permissions required to see and to enter. Empty means "any signed-in user". */
  permissions?: readonly Permission[];
  /** How to combine them. Defaults to 'any'. */
  mode?: 'any' | 'all';
  /** Hidden and unreachable while the flag is off. */
  featureFlag?: string;
  children?: readonly NavItem[];
}
