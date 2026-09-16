import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema';

export type Schema = typeof schema;

/** The Drizzle handle used everywhere. */
export type Database = NodePgDatabase<Schema>;

/**
 * A transaction handle. Services take `DbOrTx` rather than `Database` so that callers
 * can compose several service calls inside one `db.transaction(...)` without the
 * services having to know about it.
 */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Transaction;

export interface DatabaseOptions {
  url: string;
  /** Keep this conservative: the production Postgres is shared with other stacks. */
  poolMax?: number;
  ssl?: boolean;
}

export function createDatabase(options: DatabaseOptions): { db: Database; pool: Pool } {
  const poolConfig: PoolConfig = {
    connectionString: options.url,
    max: options.poolMax ?? 10,
    // A connection that cannot be established quickly is a failure, not something to
    // queue behind indefinitely — surface it so the health check goes red.
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    ...(options.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  };

  const pool = new Pool(poolConfig);
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, pool };
}
