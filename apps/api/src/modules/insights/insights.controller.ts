import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { InsightsSchema, PERMISSIONS, type Insights } from '@app/contracts';
import { project, type Database } from '@app/db';
import { ApiEnvelope, ApiStandardErrors } from '../../common';
import { CurrentOrg, type OrgContext } from '../../auth/org-context';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { DRIZZLE } from '../../database/database.module';
import { RequireSubscription } from '../billing/require-subscription.decorator';
import { SubscriptionService } from '../billing/subscription.service';

/**
 * The template's worked example of a paid feature.
 *
 * Two gates, and they are different questions: @RequirePermissions asks whether this
 * person is allowed to look, @RequireSubscription asks whether the tenant has paid.
 * A member of a subscribed organization passes both; an owner of an unsubscribed one
 * passes the first and is refused by the second, with 402 rather than 403 so the
 * client can say "upgrade" instead of "you lack permission".
 */
@ApiTags('insights')
@ApiStandardErrors()
@Controller('insights')
export class InsightsController {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly subscriptions: SubscriptionService,
  ) {}

  @Get()
  @RequirePermissions(PERMISSIONS.PROJECTS_READ)
  @RequireSubscription()
  @ApiOperation({ summary: 'Aggregate figures for the active organization (paid)' })
  @ApiEnvelope(InsightsSchema)
  async get(@CurrentOrg() org: OrgContext): Promise<Insights> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totals] = await this.db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${project.status} = 'active')`,
        archived: sql<number>`count(*) filter (where ${project.status} = 'archived')`,
      })
      .from(project)
      .where(eq(project.organizationId, org.organizationId));

    const [recent] = await this.db
      .select({ value: count() })
      .from(project)
      .where(
        and(eq(project.organizationId, org.organizationId), gte(project.createdAt, thirtyDaysAgo)),
      );

    const reference = this.subscriptions.referenceFor(org.organizationId, org.userId);
    const entitling = reference ? await this.subscriptions.findEntitling(reference) : null;

    return {
      totalProjects: Number(totals?.total ?? 0),
      activeProjects: Number(totals?.active ?? 0),
      archivedProjects: Number(totals?.archived ?? 0),
      createdLast30Days: Number(recent?.value ?? 0),
      plan: entitling?.plan ?? '',
    };
  }
}
