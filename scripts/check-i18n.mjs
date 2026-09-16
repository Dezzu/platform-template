/**
 * Asserts every locale file declares exactly the same keys.
 *
 * The IT/EN pair drifts the moment someone adds a feature and updates one file — and
 * the symptom is a raw key rendered in the interface of whichever language they did
 * not speak. Cheapest guard rail in the repo.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exit } from 'node:process';

const DIR = 'libs/i18n/src/locales';

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

if (failed) {
  console.error('');
  exit(1);
}

console.warn(`i18n: ${union.size} keys, ${locales.map((l) => l.name).join(' / ')} in sync`);
