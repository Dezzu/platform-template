import { Inject, Injectable } from '@nestjs/common';
import { type Plan, type PlanLimits } from './plans.types';
import { type Database, plan } from '@app/db';
import { asc, eq } from 'drizzle-orm';
import { DRIZZLE } from '../../database/database.module';

@Injectable()
export class PlansService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * The public plan catalogue. Read from the database rather than a constant so that
   * changing a price is a seed/migration, not a redeploy — and so the pricing page and
   * the Stripe plan configuration can never disagree.
   */
  async list(includeInactive: boolean): Promise<Plan[]> {
    const rows = await this.db
      .select()
      .from(plan)
      .where(includeInactive ? undefined : eq(plan.isActive, true))
      .orderBy(asc(plan.sortOrder));

    return rows.map((row) => ({
      id: row.id,
      key: row.key,
      nameKey: row.nameKey,
      descriptionKey: row.descriptionKey,
      amountMonthly: row.amountMonthly,
      amountYearly: row.amountYearly,
      currency: row.currency,
      limits: (row.limits ?? {}) as PlanLimits,
      features: (row.features ?? []) as string[],
      sortOrder: row.sortOrder,
      isDefault: row.isDefault,
    }));
  }
}
