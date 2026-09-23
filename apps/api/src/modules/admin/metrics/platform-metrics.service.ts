import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import type {
  MetricPoint,
  PlanBreakdown,
  PlatformMetrics,
  RevenueMetrics,
  UsageMetrics,
} from '@app/contracts';
import type { Database } from '@app/db';
import { queueConfig, redisConfig } from '../../../config/namespaces';
import { DRIZZLE } from '../../../database/database.module';

/** How long a computed snapshot stands. */
const CACHE_TTL_SECONDS = 300;

/** The window every "per day" series covers. */
const SERIES_DAYS = 30;

/**
 * The business figures, computed straight from Postgres.
 *
 * **Cached for five minutes, and shared.** These queries scan `session` and join
 * `subscription` to `plan`; the Postgres underneath is shared with twenty-odd other
 * stacks, so recomputing them on every page load — for every administrator, on every
 * navigation back to the tab — is the kind of cost that does not show up until it
 * does. A shared cache rather than an in-process one so that N containers answer from
 * one computation instead of N.
 *
 * The snapshot carries `generatedAt` and the screen shows it. A dashboard that looks
 * live and is five minutes old gets decisions made on stale numbers without anybody
 * noticing that is what happened.
 */
@Injectable()
export class PlatformMetricsService {
  private readonly logger = new Logger(PlatformMetricsService.name);
  private readonly redis: Redis;
  private readonly cacheKey: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(redisConfig.KEY) redis: ConfigType<typeof redisConfig>,
    @Inject(queueConfig.KEY) queue: ConfigType<typeof queueConfig>,
  ) {
    // Prefixed like the queues: the Valkey instance is shared, and an unprefixed key
    // is somebody else's key.
    this.cacheKey = `${queue.prefix}:metrics:platform`;
    this.redis = new Redis(redis.url, { maxRetriesPerRequest: null, lazyConnect: true });
    this.redis.on('error', (error) => this.logger.warn(`metrics cache: ${error.message}`));
    void this.redis.connect().catch(() => {
      // Losing the cache costs a few queries, not the screen. See `read`/`write`.
    });
  }

  async get(refresh = false): Promise<PlatformMetrics> {
    if (!refresh) {
      const cached = await this.read();
      if (cached) return cached;
    }

    const snapshot = await this.compute();
    await this.write(snapshot);
    return snapshot;
  }

  private async compute(): Promise<PlatformMetrics> {
    // In parallel: they touch different tables and the slowest one sets the floor.
    const [usage, revenue, signupsPerDay, activeUsersPerDay, plans] = await Promise.all([
      this.usage(),
      this.revenue(),
      this.signupsPerDay(),
      this.activeUsersPerDay(),
      this.planBreakdown(),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      usage,
      revenue,
      signupsPerDay,
      activeUsersPerDay,
      plans,
    };
  }

  // ── Usage ──────────────────────────────────────────────────────────────────

  private async usage(): Promise<UsageMetrics> {
    /**
     * One statement rather than six round trips.
     *
     * Activity is read from `session.updated_at`: Better Auth rewrites that row as the
     * session is used, so it covers people who only read — which the audit log, being
     * a record of mutations, would miss entirely. Its granularity is
     * `SESSION_UPDATE_AGE`, and the contract says so where somebody will read it.
     */
    const rows = await this.db.execute<{
      users: number;
      organizations: number;
      active_organizations: number;
      dau: number;
      wau: number;
      mau: number;
      signups_30: number;
      signups_prev_30: number;
    }>(sql`
      select
        (select count(*)::int from "user")                                    as users,
        (select count(*)::int from organization)                              as organizations,
        (select count(distinct m.organization_id)::int
           from member m
           join session s on s.user_id = m.user_id
          where s.updated_at >= now() - interval '30 days')                   as active_organizations,
        (select count(distinct user_id)::int from session
          where updated_at >= now() - interval '1 day')                       as dau,
        (select count(distinct user_id)::int from session
          where updated_at >= now() - interval '7 days')                      as wau,
        (select count(distinct user_id)::int from session
          where updated_at >= now() - interval '30 days')                     as mau,
        (select count(*)::int from "user"
          where created_at >= now() - interval '30 days')                     as signups_30,
        (select count(*)::int from "user"
          where created_at >= now() - interval '60 days'
            and created_at <  now() - interval '30 days')                     as signups_prev_30
    `);

    const row = rows.rows[0];
    const current = row?.signups_30 ?? 0;
    const previous = row?.signups_prev_30 ?? 0;

    return {
      users: row?.users ?? 0,
      organizations: row?.organizations ?? 0,
      activeOrganizations: row?.active_organizations ?? 0,
      dau: row?.dau ?? 0,
      wau: row?.wau ?? 0,
      mau: row?.mau ?? 0,
      signupsLast30Days: current,
      /**
       * Null rather than zero, or 100, when the previous window was empty.
       *
       * "+100%" against a baseline of nothing is the number that makes a launch week
       * look like growth forever. No comparison is an honest answer; a made-up one is
       * not.
       */
      signupsTrendPercent:
        previous === 0 ? null : Math.round(((current - previous) / previous) * 100),
    };
  }

  private async signupsPerDay(): Promise<MetricPoint[]> {
    const rows = await this.db.execute<{ day: string; value: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day, count(u.id)::int as value
        from generate_series(
               (now() - interval '${sql.raw(String(SERIES_DAYS - 1))} days')::date,
               now()::date,
               interval '1 day'
             ) as d(day)
        left join "user" u
          on u.created_at >= d.day and u.created_at < d.day + interval '1 day'
       group by d.day
       order by d.day
    `);

    return rows.rows.map((row) => ({ date: row.day, value: Number(row.value) }));
  }

  private async activeUsersPerDay(): Promise<MetricPoint[]> {
    const rows = await this.db.execute<{ day: string; value: number }>(sql`
      select to_char(d.day, 'YYYY-MM-DD') as day, count(distinct s.user_id)::int as value
        from generate_series(
               (now() - interval '${sql.raw(String(SERIES_DAYS - 1))} days')::date,
               now()::date,
               interval '1 day'
             ) as d(day)
        left join session s
          on s.updated_at >= d.day and s.updated_at < d.day + interval '1 day'
       group by d.day
       order by d.day
    `);

    return rows.rows.map((row) => ({ date: row.day, value: Number(row.value) }));
  }

  // ── Revenue ────────────────────────────────────────────────────────────────

  /**
   * MRR normalised to the month.
   *
   * A yearly subscription is divided by twelve rather than counted at face value: MRR
   * is a monthly rate, and mixing the two makes every January look like a miracle.
   * `seats` defaults to one — it is nullable, and a null seat count is one seat, not
   * zero revenue.
   *
   * Only `active` and `trialing` count, which is the same pair the paywall uses
   * (ENTITLING_STATUSES). A `past_due` subscription is not revenue: the card has
   * already failed.
   */
  private async revenue(): Promise<RevenueMetrics> {
    const rows = await this.db.execute<{
      mrr_cents: number;
      paying: number;
      active_subscriptions: number;
      trialing: number;
      cancelling: number;
      churned_30: number;
      currency: string | null;
    }>(sql`
      with live as (
        select s.*,
               p.amount_monthly,
               p.amount_yearly,
               p.currency,
               coalesce(s.seats, 1) as effective_seats
          from subscription s
          join plan p on p.key = s.plan
         where s.status in ('active', 'trialing')
      )
      select
        coalesce(sum(
          case when billing_interval = 'year'
               then (amount_yearly / 12.0) * effective_seats
               else amount_monthly * effective_seats
          end
        ), 0)::int                                                      as mrr_cents,
        count(*) filter (where status = 'active')::int                  as active_subscriptions,
        count(*) filter (where status = 'trialing')::int                as trialing,
        -- Recent Stripe API versions leave cancel_at_period_end false and set cancel_at
        -- instead, so reading only the boolean means never noticing a cancellation.
        count(*) filter (where cancel_at is not null or cancel_at_period_end)::int
                                                                        as cancelling,
        count(distinct reference_id)::int                               as paying,
        (select count(*)::int from subscription
          where canceled_at >= now() - interval '30 days')              as churned_30,
        (select currency from plan where is_active order by sort_order limit 1) as currency
        from live
    `);

    const row = rows.rows[0];
    const mrr = Math.round(Number(row?.mrr_cents ?? 0));
    const paying = Number(row?.paying ?? 0);

    return {
      mrrCents: mrr,
      arrCents: mrr * 12,
      arpaCents: paying === 0 ? 0 : Math.round(mrr / paying),
      currency: row?.currency ?? 'EUR',
      activeSubscriptions: Number(row?.active_subscriptions ?? 0),
      trialingSubscriptions: Number(row?.trialing ?? 0),
      cancellingSubscriptions: Number(row?.cancelling ?? 0),
      churnedLast30Days: Number(row?.churned_30 ?? 0),
    };
  }

  private async planBreakdown(): Promise<PlanBreakdown[]> {
    const rows = await this.db.execute<{
      key: string;
      subscriptions: number;
      mrr_cents: number;
    }>(sql`
      select p.key,
             count(s.id)::int as subscriptions,
             -- The FILTER clause is the whole correctness of this query.
             --
             -- It is a LEFT JOIN, so a plan nobody is on still produces one row with
             -- every subscription column null, the CASE falls through to its ELSE
             -- branch, and it bills the plan's full monthly price for a subscription
             -- that does not exist. The screen showed Business at EUR 49 with zero
             -- subscriptions, as the largest bar, while the MRR tile above it said
             -- EUR 19. Found by looking at the page.
             coalesce(sum(
               case when s.billing_interval = 'year'
                    then (p.amount_yearly / 12.0) * coalesce(s.seats, 1)
                    else p.amount_monthly * coalesce(s.seats, 1)
               end
             ) filter (where s.id is not null), 0)::int as mrr_cents
        from plan p
        left join subscription s
          on s.plan = p.key and s.status in ('active', 'trialing')
       where p.is_active
       group by p.key, p.sort_order
       order by mrr_cents desc, p.sort_order
    `);

    return rows.rows.map((row) => ({
      key: row.key,
      subscriptions: Number(row.subscriptions),
      mrrCents: Math.round(Number(row.mrr_cents)),
    }));
  }

  // ── Cache ──────────────────────────────────────────────────────────────────

  /**
   * A cache miss and a cache that is down are the same thing here: recompute.
   *
   * Never throws. Losing Valkey costs a handful of queries per page load, and a
   * dashboard that goes blank because its cache is unavailable is worse than a slow one.
   */
  private async read(): Promise<PlatformMetrics | null> {
    try {
      const raw = await this.redis.get(this.cacheKey);
      return raw ? (JSON.parse(raw) as PlatformMetrics) : null;
    } catch {
      return null;
    }
  }

  private async write(snapshot: PlatformMetrics): Promise<void> {
    try {
      await this.redis.set(this.cacheKey, JSON.stringify(snapshot), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // See `read`.
    }
  }
}
