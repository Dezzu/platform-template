import { describe, expect, it } from 'vitest';
import { NAV_MANIFEST, type NavItem } from '@app/core';
import { APP_ICONS } from './icons';

/**
 * A missing icon does not throw: ng-icons renders nothing and the menu entry simply
 * loses its glyph. That is invisible in review, invisible to the type system, and was
 * exactly how the sidebar ended up with labels and no icons.
 */
function allItems(items: readonly NavItem[]): NavItem[] {
  return items.flatMap((item) => [item, ...(item.children ? allItems(item.children) : [])]);
}

describe('icon registry', () => {
  const registered = new Set(Object.keys(APP_ICONS));

  it.each(allItems(NAV_MANIFEST).map((item) => [item.id, item.icon] as const))(
    'registers the icon for the menu entry %s (%s)',
    (_id, icon) => {
      expect(registered).toContain(icon);
    },
  );

  it('registers every icon the account menu names', () => {
    // Kept in step by hand because these live in the shell rather than in a manifest;
    // if that list grows, move it somewhere this test can read directly.
    for (const icon of ['lucideUser', 'lucideLogOut', 'lucideSun', 'lucideMoon']) {
      expect(registered).toContain(icon);
    }
  });

  it('maps every name to an actual icon definition', () => {
    for (const [name, definition] of Object.entries(APP_ICONS)) {
      expect(typeof definition, `${name} should be an SVG string`).toBe('string');
      expect(definition.length, `${name} should not be empty`).toBeGreaterThan(0);
    }
  });
});
