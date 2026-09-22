import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { AllowDuringMaintenance } from '../maintenance/maintenance.decorator';
import type { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { env, redactedConfig } from '../../config/validate-env';

/**
 * Two endpoints with different meanings, and the distinction matters for the compose
 * `depends_on` chain and for the post-deploy smoke test:
 *
 *   /health/live  — the process is up. Never touches dependencies. If this fails,
 *                   restarting the container is the right response.
 *   /health/ready — the process can actually serve traffic: database reachable.
 *                   A failure here means "stop sending me requests", not "restart me".
 */
/**
 * Exempt from maintenance mode: an orchestrator reads 503 as "this container is
 * broken" and starts restarting it, so a probe that went down with the product would
 * turn a planned pause into a restart loop.
 */
@AllowDuringMaintenance()
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

  /**
   * The effective configuration with every secret masked — the fastest way to answer
   * "is this container actually running the settings I think it is?".
   *
   * Not exposed in production: even redacted, the variable list tells an attacker
   * which integrations exist. In production use the admin module instead, behind
   * `platform.metrics.read`.
   */
  @Get('info')
  @AllowAnonymous()
  info(): Record<string, unknown> {
    if (env().NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    return redactedConfig();
  }
}
