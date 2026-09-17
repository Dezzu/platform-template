import { randomUUID } from 'node:crypto';

/** Longest slug kept from the original name; the extension is appended after it. */
const MAX_SLUG_LENGTH = 60;

/**
 * Turns a user-supplied file name into something safe to put in a key.
 *
 * The name is attacker input: `../../etc/passwd`, a 4 KB unicode string, or a name
 * that differs from another only by an invisible character. Everything outside
 * `[a-z0-9-]` goes, which also removes the path separators that would otherwise let a
 * key escape its tenant prefix.
 */
export function slugify(value: string): string {
  const slug = value
    .normalize('NFKD')
    // Strip combining marks so "è" becomes "e" rather than disappearing entirely.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);

  // A name made entirely of characters we strip ("日本語.pdf") must still produce a key.
  return slug || 'file';
}

/**
 * `{orgId}/{yyyy}/{mm}/{uuid}-{slug}{ext}`.
 *
 * The tenant id leads so that a bucket listing is browsable per customer and a future
 * per-prefix policy is expressible. The date segments keep any single prefix from
 * growing without bound. The UUID is what makes the key unique — the slug is there
 * only so a human recognises the object, and two files called "report.pdf" must not
 * collide.
 */
export function buildObjectKey(input: {
  organizationId: string;
  fileName: string;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');

  const lastDot = input.fileName.lastIndexOf('.');
  const rawExtension = lastDot > 0 ? input.fileName.slice(lastDot + 1) : '';
  const extension = rawExtension
    .replace(/[^a-zA-Z0-9]/g, '')
    .toLowerCase()
    .slice(0, 10);
  const base = lastDot > 0 ? input.fileName.slice(0, lastDot) : input.fileName;

  const name = `${randomUUID()}-${slugify(base)}${extension ? `.${extension}` : ''}`;
  return `${input.organizationId}/${year}/${month}/${name}`;
}
