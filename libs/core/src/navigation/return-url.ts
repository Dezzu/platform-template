/** The query parameter carrying where the visitor was actually going. */
export const RETURN_URL_PARAM = 'redirect';

/**
 * Validates a return URL before anything navigates to it.
 *
 * Only a path within this application: it must start with a single `/`, which rules
 * out `https://evil.example`, protocol-relative `//evil.example`, and the backslash
 * variants some parsers normalise into them. Anything else yields null and the caller
 * falls back to its own default.
 *
 * Worth the strictness even though Angular's Router would not leave the origin on its
 * own: this value comes from a query string, which means it comes from whoever wrote
 * the link, and "the router probably won't" is not a security property.
 */
export function safeReturnUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.includes('\\')) return null;
  return value;
}
