import { Inject, Injectable } from '@nestjs/common';
import { asc, count, desc, eq, ilike, or } from 'drizzle-orm';
import {
  ERROR_CODES,
  type FeatureFlag,
  type FeatureFlagCreate,
  type FeatureFlagListQuery,
  type FeatureFlagUpdate,
  type Paginated,
  type ResolvedFlags,
} from '@app/contracts';
import { featureFlag, type Database } from '@app/db';
import { AppException } from '../../common';
import { DRIZZLE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { PlatformActor } from '../admin/admin-users.service';

type FlagRow = typeof featureFlag.$inferSelect;

/**
 * How long a resolved answer is reused. Short enough that turning a flag off is felt
 * within seconds, long enough that a guarded endpoint under load is not two extra
 * queries per request.
 *
 * The cache is per process, so with several API containers the real bound is this TTL
 * rather than the invalidation below — which is exactly why it is seconds and not
 * minutes. Anything needing instant, cluster-wide propagation would need Valkey
 * pub/sub, and a flag is not that: it is a setting, not a revocation.
 */
const RESOLUTION_TTL_MS = 10_000;

/**
 * Feature flags: one switch each, the same answer for everybody.
 *
 * There used to be a resolution order here — user override, then organization
 * override, then a percentage rollout bucketed on a stable hash, then the global
 * switch. It is gone. That machinery serves gradual release to a slice of customers;
 * what this product needs is a superadmin saying "this is still beta, keep it off",
 * and four levels of precedence to express one boolean is four places for it to be
 * wrong.
 *
 * A flag that has to be true for one customer and false for another is not a flag —
 * it is an entitlement of their plan or a setting on their organization. Those are
 * data about a customer; this is a decision about the product.
 */
@Injectable()
export class FlagsService {
  private cache: { at: number; flags: ResolvedFlags } | null = null;

  constructor(
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /**
   * Every flag and whether it is on. Cached for {@link RESOLUTION_TTL_MS}.
   *
   * No argument any more: the answer no longer depends on who is asking, and a
   * parameter kept "just in case" would be a parameter every caller has to invent a
   * value for.
   */
  async resolve(): Promise<ResolvedFlags> {
    const hit = this.cache;
    if (hit && Date.now() - hit.at < RESOLUTION_TTL_MS) return hit.flags;

    const definitions = await this.db.select().from(featureFlag);

    const resolved: ResolvedFlags = {};
    for (const flag of definitions) resolved[flag.key] = flag.enabled;

    this.cache = { at: Date.now(), flags: resolved };
    return resolved;
  }

  /** Whether one flag is on. */
  async isEnabled(key: string): Promise<boolean> {
    const flags = await this.resolve();
    // An unknown key is off. A typo in a guard must not open a feature: the safe
    // reading of "I have never heard of this flag" is "not for you".
    return flags[key] ?? false;
  }

  async list(query: FeatureFlagListQuery): Promise<Paginated<FeatureFlag>> {
    const where = query.q
      ? or(ilike(featureFlag.key, `%${query.q}%`), ilike(featureFlag.description, `%${query.q}%`))
      : undefined;

    // Closed list: the sort field arrives from the client and an unchecked ORDER BY is
    // an injection point.
    const sortable = { key: featureFlag.key, enabled: featureFlag.enabled };
    const column =
      query.sort && query.sort in sortable
        ? sortable[query.sort as keyof typeof sortable]
        : featureFlag.key;
    const orderBy = query.dir === 'desc' ? desc(column) : asc(column);

    const [rows, totals] = await Promise.all([
      this.db
        .select()
        .from(featureFlag)
        .where(where)
        .orderBy(orderBy)
        .limit(query.size)
        .offset(query.page * query.size),
      this.db.select({ value: count() }).from(featureFlag).where(where),
    ]);

    const total = totals[0]?.value ?? 0;
    return {
      items: rows.map(toDto),
      meta: {
        page: query.page,
        size: query.size,
        total,
        totalPages: Math.ceil(total / query.size),
      },
    };
  }

  async getByKey(key: string): Promise<FeatureFlag> {
    const [row] = await this.db.select().from(featureFlag).where(eq(featureFlag.key, key)).limit(1);
    if (!row) throw AppException.notFound('Feature flag', ERROR_CODES.FLAG_NOT_FOUND);

    return toDto(row);
  }

  async create(actor: PlatformActor, input: FeatureFlagCreate): Promise<FeatureFlag> {
    const created = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ key: featureFlag.key })
        .from(featureFlag)
        .where(eq(featureFlag.key, input.key))
        .limit(1);
      if (existing) {
        throw AppException.conflict(
          `A feature flag named "${input.key}" already exists`,
          ERROR_CODES.FLAG_ALREADY_EXISTS,
        );
      }

      const [row] = await tx
        .insert(featureFlag)
        .values({
          key: input.key,
          description: input.description ?? null,
          enabled: input.enabled ?? false,
        })
        .returning();

      await this.audit.record(
        {
          // Null: flags belong to the platform, not to any tenant.
          organizationId: null,
          actorUserId: actor.userId,
          action: 'flag.created',
          resourceType: 'feature_flag',
          resourceId: input.key,
          after: row,
        },
        tx,
      );

      return row;
    });

    this.invalidate();
    return toDto(created as FlagRow);
  }

  async update(actor: PlatformActor, key: string, input: FeatureFlagUpdate): Promise<FeatureFlag> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(featureFlag).where(eq(featureFlag.key, key)).limit(1);
      if (!before) throw AppException.notFound('Feature flag', ERROR_CODES.FLAG_NOT_FOUND);

      const [after] = await tx
        .update(featureFlag)
        .set({
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          updatedAt: new Date(),
        })
        .where(eq(featureFlag.key, key))
        .returning();

      await this.audit.record(
        {
          organizationId: null,
          actorUserId: actor.userId,
          action: 'flag.updated',
          resourceType: 'feature_flag',
          resourceId: key,
          before,
          after,
        },
        tx,
      );
    });

    this.invalidate();
    return this.getByKey(key);
  }

  async remove(actor: PlatformActor, key: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx.select().from(featureFlag).where(eq(featureFlag.key, key)).limit(1);
      if (!before) throw AppException.notFound('Feature flag', ERROR_CODES.FLAG_NOT_FOUND);

      // Overrides go with it: the foreign key cascades, which is what stops a
      // recreated key from silently inheriting last month's exceptions.
      await tx.delete(featureFlag).where(eq(featureFlag.key, key));

      await this.audit.record(
        {
          organizationId: null,
          actorUserId: actor.userId,
          action: 'flag.deleted',
          resourceType: 'feature_flag',
          resourceId: key,
          before,
        },
        tx,
      );
    });

    this.invalidate();
  }

  /** The exceptions for one flag, with the subject named rather than just identified. */
  /**
   * Drops every cached answer.
   *
   * One entry now, so there is nothing to be selective about — and a flag change is
   * rare enough that re-reading a handful of rows costs nothing.
   */
  private invalidate(): void {
    this.cache = null;
  }
}

function toDto(row: FlagRow): FeatureFlag {
  return {
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
