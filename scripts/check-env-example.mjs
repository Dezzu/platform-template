/**
 * Asserts that .env.example and apps/api/src/config/env.schema.ts describe the same
 * set of variables.
 *
 * Without this the two drift silently: someone adds a variable to the schema, the app
 * works on their machine because their .env has it, and the next person to clone the
 * repo gets a startup failure with no hint of what to add.
 */
import { readFileSync } from 'node:fs';
import { exit } from 'node:process';

const SCHEMA = 'apps/api/src/config/env.schema.ts';
const EXAMPLE = '.env.example';

const schemaSource = readFileSync(SCHEMA, 'utf8');
// Only the object literal, so the cross-field function's references do not count.
const objectBody = schemaSource.slice(
  schemaSource.indexOf('const baseEnvSchema = z.object({'),
  schemaSource.indexOf('export function crossFieldIssues'),
);

const schemaKeys = new Set(
  // Any indentation (Prettier reflows it) and any value expression — fields are
  // written as `z.…`, `bool(…)` or `csv`, so anchoring on `z.` would miss some.
  // SCREAMING_SNAKE keys only, which comments cannot look like.
  [...objectBody.matchAll(/^\s+([A-Z][A-Z0-9_]*):\s*\S/gm)].map((m) => m[1]),
);
const exampleKeys = new Set(
  [...readFileSync(EXAMPLE, 'utf8').matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]),
);

const missingFromExample = [...schemaKeys].filter((k) => !exampleKeys.has(k)).sort();
const missingFromSchema = [...exampleKeys].filter((k) => !schemaKeys.has(k)).sort();

if (schemaKeys.size === 0) {
  console.error(`could not parse any variables out of ${SCHEMA} — has its shape changed?`);
  exit(1);
}

if (missingFromExample.length === 0 && missingFromSchema.length === 0) {
  console.warn(`env: ${schemaKeys.size} variables, .env.example in sync`);
  exit(0);
}

if (missingFromExample.length > 0) {
  console.error(`\nIn ${SCHEMA} but missing from ${EXAMPLE}:`);
  for (const k of missingFromExample) console.error(`  ✗ ${k}`);
}
if (missingFromSchema.length > 0) {
  console.error(`\nIn ${EXAMPLE} but missing from ${SCHEMA}:`);
  for (const k of missingFromSchema) console.error(`  ✗ ${k}`);
}
console.error('');
exit(1);
