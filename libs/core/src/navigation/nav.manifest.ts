// Deep import on purpose: the '@app/contracts' barrel re-exports Zod schemas built
// at module top level, which bundlers cannot tree-shake, and this file is on the
// eager path. Importing the constants directly keeps Zod out of the initial bundle.
import { PERMISSIONS } from '@app/contracts/permissions';
import type { NavItem } from './nav.model';

/**
 * The application menu.
 *
 * Adding a feature means adding an entry here — it is a mandatory step of the
 * end-to-end checklist in CLAUDE.md, because a route guarded by permissions but
 * missing from the manifest is a page nobody can find.
 *
 * The converse is enforced by a test: an entry without a matching route is a dead
 * link, so entries arrive together with the screen they open, never before it.
 * Members, billing, audit and settings will appear here with their features.
 */
export const NAV_MANIFEST: readonly NavItem[] = [
  {
    id: 'dashboard',
    labelKey: 'nav.dashboard',
    icon: 'lucideLayoutDashboard',
    route: '/dashboard',
  },
  {
    id: 'projects',
    labelKey: 'nav.projects',
    icon: 'lucideFolderKanban',
    route: '/projects',
    permissions: [PERMISSIONS.PROJECTS_READ],
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
