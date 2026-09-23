import { computed, DOCUMENT, inject, PLATFORM_ID, Service, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_DAYS,
  CONSENT_VERSION,
  defaultConsent,
  parseConsent,
  type ConsentCategory,
  type ConsentRecord,
} from '@app/contracts/consent';

/**
 * What this browser has agreed may be stored on it.
 *
 * **A cookie, not a row.** The visitor the banner exists for is the one who has no
 * account yet, so a server-side record would cover only the people who least need
 * asking. It is first-party, `SameSite=Lax` and carries no identifier — it records an
 * answer, not a person.
 *
 * **Absence is not consent.** No cookie, a malformed one, or one written against an
 * older `CONSENT_VERSION` all mean the same thing: this question has not been
 * answered, so the banner comes back and everything optional stays off. Bumping the
 * version is how a new category gets asked about instead of being assumed.
 *
 * Safe under prerendering: on the server there is no cookie to read and the service
 * reports "not decided", which is what the static HTML should say. The banner carries
 * `ngSkipHydration` because the browser then reads the real answer and may legitimately
 * render nothing where the server rendered a banner.
 */
@Service()
export class ConsentService {
  private readonly document = inject(DOCUMENT);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  private readonly record = signal<ConsentRecord | undefined>(this.read());

  /** Set when somebody reopens the choice from a footer link. */
  private readonly reopened = signal(false);

  /** True once this browser has answered the current version of the question. */
  readonly decided = computed(() => this.record() !== undefined);

  /** The effective answer per category — the defaults until somebody decides. */
  readonly granted = computed(() => this.record()?.granted ?? defaultConsent());

  /** Whether the banner should be on screen. */
  readonly visible = computed(() => !this.decided() || this.reopened());

  /** When the current answer was given, for the "you agreed on …" line. */
  readonly decidedAt = computed(() => this.record()?.decidedAt ?? null);

  /**
   * Whether a category may be used right now.
   *
   * The single question every caller asks — loading an analytics script, remembering a
   * preference — so that "did they agree" is answered in one place rather than by each
   * feature reading the cookie its own way.
   */
  allows(category: ConsentCategory): boolean {
    return this.granted()[category];
  }

  acceptAll(): void {
    this.save(
      Object.fromEntries(Object.keys(defaultConsent()).map((key) => [key, true])) as Record<
        ConsentCategory,
        boolean
      >,
    );
  }

  /**
   * Refusing everything that can be refused.
   *
   * As prominent as accepting, and exactly as cheap: a banner where "reject" takes an
   * extra screen is the pattern the regulators went after.
   */
  rejectAll(): void {
    this.save(defaultConsent());
  }

  save(granted: Record<ConsentCategory, boolean>): void {
    const record: ConsentRecord = {
      version: CONSENT_VERSION,
      decidedAt: new Date().toISOString(),
      // Required categories are forced on rather than trusted from the caller: a
      // component that forgot one would otherwise write "no" to something the product
      // cannot run without.
      granted: { ...granted, ...pickRequired() },
    };

    this.record.set(record);
    this.reopened.set(false);
    this.write(record);
  }

  /** Brings the banner back so a decision can be changed. Required, and a footer link. */
  reopen(): void {
    this.reopened.set(true);
  }

  private read(): ConsentRecord | undefined {
    if (!this.isBrowser) return undefined;

    const match = this.document.cookie
      .split('; ')
      .find((entry) => entry.startsWith(`${CONSENT_COOKIE}=`));

    return parseConsent(match ? decodeURIComponent(match.slice(CONSENT_COOKIE.length + 1)) : null);
  }

  private write(record: ConsentRecord): void {
    if (!this.isBrowser) return;

    const value = encodeURIComponent(JSON.stringify(record));
    const maxAge = CONSENT_MAX_AGE_DAYS * 86_400;
    // `Secure` only over https: set unconditionally it would be dropped on the plain
    // http of a development machine, and the banner would come back on every reload.
    const secure = this.document.location.protocol === 'https:' ? '; Secure' : '';

    this.document.cookie = `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
  }
}

function pickRequired(): Partial<Record<ConsentCategory, boolean>> {
  const defaults = defaultConsent();
  return Object.fromEntries(Object.entries(defaults).filter(([, on]) => on));
}
