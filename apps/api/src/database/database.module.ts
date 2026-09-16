import { Global, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Database } from '@app/db';
import type { Pool } from 'pg';
import { getDatabase } from './db';

/** Injection token for the Drizzle handle. */
export const DRIZZLE = Symbol('DRIZZLE');
/** Injection token for the raw pg pool — only the health check should need this. */
export const PG_POOL = Symbol('PG_POOL');

@Global()
@Module({
  providers: [
    { provide: DRIZZLE, useFactory: (): Database => getDatabase().db },
    { provide: PG_POOL, useFactory: (): Pool => getDatabase().pool },
  ],
  exports: [DRIZZLE, PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    // Drain the pool so in-flight queries finish before the container exits.
    await getDatabase().pool.end();
  }
}
