import { describe, expect, it } from 'vitest';
import type { Route } from '@angular/router';
import { NAV_MANIFEST } from '@app/core';
import { routes } from './app.routes';

/** Every path declared anywhere in the route tree, without leading slashes. */
function declaredPaths(tree: readonly Route[], prefix = ''): string[] {
  return tree.flatMap((route) => {
    const path = [prefix, route.path ?? ''].filter(Boolean).join('/');
    return [path, ...(route.children ? declaredPaths(route.children, path) : [])];
  });
}

/**
 * Guards the invariant the whole navigation design rests on: the sidebar and the
 * router read the same manifest, so the menu cannot offer a link that leads nowhere.
 *
 * Without this the failure is silent and only shows up as a user clicking an item and
 * landing on a blank page — which is exactly the kind of thing that survives to
 * production.
 */
describe('NAV_MANIFEST and the router', () => {
  const paths = new Set(declaredPaths(routes));

  it.each(NAV_MANIFEST.map((item) => [item.id, item.route] as const))(
    'has a route for the menu entry %s (%s)',
    (_id, route) => {
      expect(paths).toContain(route.replace(/^\//, ''));
    },
  );

  it('gives every entry a translation key rather than a literal label', () => {
    for (const item of NAV_MANIFEST) {
      expect(item.labelKey).toMatch(/^[a-z][\w.]*$/);
      expect(item.labelKey).toContain('.');
    }
  });

  it('exposes both authentication screens, so each can link to the other', () => {
    // A sign-in form with no way to reach sign-up is a dead end for a new visitor.
    expect(paths).toContain('sign-in');
    expect(paths).toContain('sign-up');
  });

  it('keeps the authentication screens out of reach once signed in', () => {
    const authRoutes = routes.filter((r) => r.path === 'sign-in' || r.path === 'sign-up');
    expect(authRoutes).toHaveLength(2);
    for (const route of authRoutes) {
      expect(route.canMatch ?? []).not.toHaveLength(0);
    }
  });

  it('uses unique ids, since navGuard() resolves entries by id', () => {
    const ids = NAV_MANIFEST.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
