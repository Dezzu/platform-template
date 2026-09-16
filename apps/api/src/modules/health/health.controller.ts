import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

/**
 * Two endpoints with different meanings, and the distinction matters for the compose
 * `depends_on` chain and for the post-deploy smoke test:
 *
 *   /health/live  — the process is up. Never touches dependencies. If this fails,
 *                   restarting the container is the right response.
 *   /health/ready — the process can actually serve traffic: database reachable.
 *                   A failure here means "stop sending me requests", not "restart me".
 */
@Controller('health')
export class HealthController {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  @Get('live')
  @AllowAnonymous()
  live(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Get('ready')
  @AllowAnonymous()
  async ready(): Promise<{ status: 'ok'; checks: Record<string, 'ok'> }> {
    try {
      await this.pool.query('select 1');
    } catch (error: unknown) {
      throw new ServiceUnavailableException({
        status: 'error',
        checks: { database: 'error' },
        message: error instanceof Error ? error.message : 'database unreachable',
      });
    }
    return { status: 'ok', checks: { database: 'ok' } };
  }
}
