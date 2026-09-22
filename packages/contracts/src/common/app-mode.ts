/**
 * What kind of product this deployment is.
 *
 * One variable, because the three things it decides are one decision. A deployment
 * that billed the person but showed a members screen, or that created organizations
 * silently while asking for their name, would be a product that cannot explain itself.
 *
 * What it drives:
 *
 * | | `b2c` | `b2b` |
 * | --- | --- | --- |
 * | Subscription hangs off | the person | the organization |
 * | Organization at signup | created automatically, never named | the user creates it |
 * | Members screen | hidden | the point of the product |
 *
 * What it does NOT change: organizations exist either way. They are the isolation
 * boundary for every domain table, not a feature of the B2B plan — in `b2c` they are
 * plumbing the user never sees. Keeping them means a personal product that one day
 * sells to teams adds a member row, instead of rewriting every table from `user_id`
 * to `organization_id` with the data already in it.
 *
 * See docs/modalita-utente-e-organizzazione.md.
 */
export const APP_MODES = ['b2c', 'b2b'] as const;
export type AppMode = (typeof APP_MODES)[number];

/** The default. A personal product is the smaller promise, so it is the safer default. */
export const DEFAULT_APP_MODE: AppMode = 'b2c';

export function isAppMode(value: string): value is AppMode {
  return (APP_MODES as readonly string[]).includes(value);
}

/**
 * Whether a subscription hangs off the person rather than the tenant.
 *
 * Derived, never configured separately: two variables that can contradict each other
 * are a deployment that bills the wrong party and nobody notices until an invoice.
 */
export function billsThePerson(mode: AppMode): boolean {
  return mode === 'b2c';
}

/** Whether an organization is created for a new account without asking. */
export function createsOrganizationOnSignUp(mode: AppMode): boolean {
  return mode === 'b2c';
}
