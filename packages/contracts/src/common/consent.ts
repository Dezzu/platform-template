/**
 * Cookie consent: what may be stored on somebody's device, and how they said so.
 *
 * Deliberately Zod-free and dependency-free. It is imported by `libs/core` (which
 * records the choice) and by `libs/ui` (which draws the banner), both on the eager
 * path of two applications — a schema built at module top level would drag Zod into
 * the initial bundle of a prerendered marketing page for no benefit.
 *
 * **The consent lives in a first-party cookie, not in the database.** There is no
 * account behind a visitor who has not signed up, which is precisely the visitor the
 * banner exists for; a server-side record would only cover the minority who are
 * already customers. The cookie carries the version it was given so that adding a
 * category later re-asks instead of silently assuming an answer to a question that
 * was never put.
 */

export const CONSENT_CATEGORIES = ['necessary', 'preferences', 'analytics', 'marketing'] as const;
export type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];

export interface ConsentCategoryDefinition {
  id: ConsentCategory;
  /** i18n keys, resolved by whoever renders. Never sentences. */
  labelKey: string;
  descriptionKey: string;
  /**
   * True for what the product cannot work without — the session cookie, the theme,
   * this very record. Shown as a locked switch rather than hidden: "you cannot turn
   * this off" is information, and a category the reader never sees reads as a category
   * somebody is hiding.
   */
  required: boolean;
}

export const CONSENT_REGISTRY: readonly ConsentCategoryDefinition[] = [
  {
    id: 'necessary',
    labelKey: 'consent.categories.necessary.label',
    descriptionKey: 'consent.categories.necessary.description',
    required: true,
  },
  {
    id: 'preferences',
    labelKey: 'consent.categories.preferences.label',
    descriptionKey: 'consent.categories.preferences.description',
    required: false,
  },
  {
    id: 'analytics',
    labelKey: 'consent.categories.analytics.label',
    descriptionKey: 'consent.categories.analytics.description',
    required: false,
  },
  {
    id: 'marketing',
    labelKey: 'consent.categories.marketing.label',
    descriptionKey: 'consent.categories.marketing.description',
    required: false,
  },
];

/**
 * Bumped whenever a category is added or what one covers changes materially.
 *
 * A stored record from an older version is treated as no answer at all: consent is to
 * a specific question, and carrying an old "yes" over to a question that now includes
 * something else is exactly the practice the regulation is about.
 */
export const CONSENT_VERSION = 1;

/** The cookie's name. First-party, `SameSite=Lax`, and readable by the server. */
export const CONSENT_COOKIE = 'cookie_consent';

/** Six months. Long enough not to nag, short enough that consent stays a decision. */
export const CONSENT_MAX_AGE_DAYS = 180;

export interface ConsentRecord {
  version: number;
  /** ISO 8601, so "when did they agree" survives a support conversation. */
  decidedAt: string;
  granted: Record<ConsentCategory, boolean>;
}

/** Everything off except what the product cannot run without. The starting point. */
export function defaultConsent(): Record<ConsentCategory, boolean> {
  return Object.fromEntries(
    CONSENT_REGISTRY.map((category) => [category.id, category.required]),
  ) as Record<ConsentCategory, boolean>;
}

/**
 * Reads a stored record, or undefined when there is nothing usable.
 *
 * Undefined for a record from an older version, for a malformed one, and for one whose
 * categories no longer match the registry — in every case the honest answer is that
 * this person has not answered *this* question, and the banner comes back.
 */
export function parseConsent(raw: string | null | undefined): ConsentRecord | undefined {
  if (!raw) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;

    const record = parsed as Partial<ConsentRecord>;
    if (record.version !== CONSENT_VERSION) return undefined;
    if (typeof record.decidedAt !== 'string') return undefined;
    if (typeof record.granted !== 'object' || record.granted === null) return undefined;

    const granted = defaultConsent();
    for (const category of CONSENT_REGISTRY) {
      const value = (record.granted as Record<string, unknown>)[category.id];
      if (typeof value !== 'boolean') return undefined;
      granted[category.id] = category.required || value;
    }

    return { version: CONSENT_VERSION, decidedAt: record.decidedAt, granted };
  } catch {
    return undefined;
  }
}
