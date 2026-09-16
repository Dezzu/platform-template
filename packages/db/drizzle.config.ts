import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'drizzle-kit';

// drizzle-kit runs with cwd = packages/db, but there is a single .env at the repo root.
loadEnv({ path: resolve(__dirname, '../../.env'), quiet: true });

const url = process.env['DATABASE_URL'];
if (!url) {
  throw new Error('DATABASE_URL is required to run drizzle-kit. Copy .env.example to .env first.');
}

export default defineConfig({
  dialect: 'postgresql',
  // Both the generated Better Auth schema and our own tables are picked up here.
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url },
  // Explicit casing so generated SQL stays snake_case even if a column name is omitted.
  casing: 'snake_case',
  verbose: true,
  strict: true,
});
