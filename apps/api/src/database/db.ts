import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createDatabase, type Database } from '@app/db';
import type { Pool } from 'pg';

// Loaded here rather than through ConfigService on purpose: `auth.config.ts` must be
// importable by the Better Auth CLI (`pnpm auth:generate`), which runs outside the Nest
// application context and therefore has no DI container. Keeping one module-scope
// singleton means the CLI and the running app share exactly one connection pool.
loadEnv({ path: resolve(__dirname, '../../../../.env'), quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  }
  return value;
}

let instance: { db: Database; pool: Pool } | undefined;

export function getDatabase(): { db: Database; pool: Pool } {
  instance ??= createDatabase({
    url: required('DATABASE_URL'),
    poolMax: Number(process.env['DATABASE_POOL_MAX'] ?? 10),
    ssl: process.env['DATABASE_SSL'] === 'true',
  });
  return instance;
}

export const db: Database = getDatabase().db;
