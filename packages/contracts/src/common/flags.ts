/**
 * Feature flag keys that code — not just an administrator — depends on.
 *
 * Deliberately Zod-free and in its own module, reachable as `@app/contracts/flags`.
 * Both the router and the application shell read this, and those are on the eager path:
 * importing it through the `@app/contracts` barrel drags Zod into the initial bundle,
 * which is exactly the trap CLAUDE.md §5 describes. It did, the moment this constant
 * was added — the initial bundle went from 821 kB to 1.26 MB and the budget refused the
 * build, which is the mechanism working.
 *
 * Most flags never belong here: a flag that only gates a menu entry lives in
 * NAV_MANIFEST, and one that only gates a route lives in the route. A key earns a name
 * when several places must agree on it.
 */

/**
 * The in-app notification centre: the bell, the panel, the page, and whether a
 * `notification` row is written at all.
 *
 * It gates the **in-app channel only**. Email is outside it on purpose —
 * `billing.payment_failed` is mandatory by email, and a platform switch that silently
 * muted a failed renewal would take the product away from somebody who was never told.
 */
export const IN_APP_NOTIFICATIONS_FLAG = 'notifications.inApp';
