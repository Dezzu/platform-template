/**
 * Two checks over the locale files.
 *
 * 1. Every locale declares exactly the same keys. The IT/EN pair drifts the moment
 *    someone adds a feature and updates one file — and the symptom is a raw key
 *    rendered in the interface of whichever language they did not speak.
 * 2. Every ErrorCode has an `errors.<CODE>` entry. The envelope's whole point is that
 *    the client renders `errors.${messageCode}`, so a code without a translation is a
 *    screaming-snake-case string shown to a customer at the exact moment something has
 *    already gone wrong.
 *
 * Cheapest guard rails in the repo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exit } from 'node:process';

const DIR = 'libs/i18n/src/locales';
const ERROR_CODES_FILE = 'packages/contracts/src/common/error-codes.ts';

const flatten = (value, prefix = '') =>
  Object.entries(value).flatMap(([key, v]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? flatten(v, path) : [path];
  });

const locales = readdirSync(DIR)
  .filter((f) => f.endsWith('.json'))
  .map((file) => ({
    name: file.replace('.json', ''),
    keys: new Set(flatten(JSON.parse(readFileSync(join(DIR, file), 'utf8')))),
  }));

if (locales.length < 2) {
  console.error(`i18n: expected at least two locale files in ${DIR}, found ${locales.length}`);
  exit(1);
}

const union = new Set(locales.flatMap((l) => [...l.keys]));
let failed = false;

for (const locale of locales) {
  const missing = [...union].filter((k) => !locale.keys.has(k)).sort();
  if (missing.length > 0) {
    failed = true;
    console.error(`\nMissing from ${locale.name}.json:`);
    for (const key of missing) console.error(`  ✗ ${key}`);
  }
}

// Every ErrorCode needs a translation. Read as text rather than imported: this script
// runs before the workspace is built, and importing would make the check depend on it.
const errorCodesSource = readFileSync(ERROR_CODES_FILE, 'utf8');
const objectBody = errorCodesSource.slice(
  errorCodesSource.indexOf('export const ERROR_CODES = {'),
  errorCodesSource.indexOf('} as const;'),
);
const errorCodes = [...objectBody.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*'/gm)].map((m) => m[1]);

if (errorCodes.length === 0) {
  console.error(`could not parse any codes out of ${ERROR_CODES_FILE} — has its shape changed?`);
  exit(1);
}

const untranslated = errorCodes.filter((code) => !union.has(`errors.${code}`)).sort();
if (untranslated.length > 0) {
  failed = true;
  console.error('\nError codes with no translation:');
  for (const code of untranslated) console.error(`  ✗ errors.${code}`);
}

if (failed) {
  console.error('');
  exit(1);
}

console.warn(
  `i18n: ${union.size} keys, ${locales.map((l) => l.name).join(' / ')} in sync; ` +
    `${errorCodes.length} error codes translated`,
);
