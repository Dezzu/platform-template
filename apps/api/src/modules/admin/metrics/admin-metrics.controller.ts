import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PLATFORM_PERMISSIONS, PlatformMetricsSchema, type PlatformMetrics } from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors } from '../../../common';
import { RequirePlatformPermission } from '../../../auth/permissions.decorator';
import { PlatformMetricsService } from './platform-metrics.service';

/**
 * The business dashboard's one endpoint.
 *
 * `platform.metrics.read`, which both `admin` and `superadmin` hold: what the product
 * earns is exactly the sort of thing a support administrator should be able to see
 * without being able to change anybody's plan.
 *
 * No tenant is resolved and none should be — these figures are about the platform, and
 * a platform-level route that quietly needed an active organization would be a route
 * that fails for whoever has not picked one.
 */
@ApiTags('admin')
@ApiStandardErrors()
@Controller('admin/metrics')
export class AdminMetricsController {
  constructor(private readonly metrics: PlatformMetricsService) {}

  @Get()
  @RequirePlatformPermission(PLATFORM_PERMISSIONS.METRICS_READ)
  @ApiOperation({ summary: 'Usage and revenue for the whole platform' })
  @ApiEnvelope(PlatformMetricsSchema)
  get(@Query('refresh') refresh?: string): Promise<PlatformMetrics> {
    /**
     * An explicit way past the cache, because the alternative is worse.
     *
     * Without it, somebody who has just fixed a subscription and wants to see the
     * number move waits five minutes with no way to tell whether the dashboard is
     * stale or the fix did not work. The screen offers it as a button and says when
     * the snapshot was taken.
     */
    return this.metrics.get(refresh === 'true');
  }
}
