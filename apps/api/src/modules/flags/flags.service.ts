import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type FeatureFlag,
  type FeatureFlagCreate,
  type FeatureFlagListQuery,
  type FeatureFlagOverride,
  type FeatureFlagOverrideCreate,
  type FeatureFlagUpdate,
  type Paginated,
  type ResolvedFlags,
} from '@app/contracts';
import { featureFlag, featureFlagOverride, organization, user, type Database } from '@app/db';
import { AppException } from '../../common';
import { DRIZZLE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { PlatformActor } from '../admin/admin-users.service';

/** Who the flags are being resolved for. Either part may be absent. */
export interface FlagSubject {
  userId: string | null;
  organizationId: string | null;
}

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
 * Feature flags, and the one place their resolution order is implemented:
 *
 *   user override -> organization override -> percentage rollout -> global `enabled`
 *
 * The percentage is consulted only when the global switch is off: "on for everyone"
 * has to mean on for everyone, and a rollout that could subtract from it would make
 * `enabled` a suggestion.
 *
 * The rollout bucket is a stable hash of `key:subject`, never a random draw. Random
 * would move a user in and out of the feature on every request, which is the worst
 * possible way to ship something gradually — the bug reports would describe a product
 * that changes shape while you use it.
 */
@Injectable()
export class FlagsService {
  private readonly cache = new Map<string, { at: number; flags: ResolvedFlags }>();

  constructor(
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  /** Every flag, resolved for one caller. Cached for {@link RESOLUTION_TTL_MS}. */
  async resolve(subject: FlagSubject): Promise<ResolvedFlags> {
    const key = `${subject.userId ?? '-'}:${subject.organizationId ?? '-'}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < RESOLUTION_TTL_MS) return hit.flags;

    const definitions = await this.db.select().from(featureFlag);
    const overrides = await this.loadOverridesFor(subject);

    const resolved: ResolvedFlags = {};
    for (const flag of definitions) {
      resolved[flag.key] = this.resolveOne(flag, subject, overrides);
    }

    this.cache.set(key, { at: Date.now(), flags: resolved });
    return resolved;
  }

  /** Whether one flag is on for this caller. */
  async isEnabled(key: string, subject: FlagSubject): Promise<boolean> {
    const flags = await this.resolve(subject);
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

    const overrideCount = this.db
      .select({ value: count() })
      .from(featureFlagOverride)
      .where(eq(featureFlagOverride.flagKey, featureFlag.key));

    const [rows, totals] = await Promise.all([
      this.db
        .select({ flag: featureFlag, overrideCount: sql<number>`(${overrideCount})` })
        .from(featureFlag)
        .where(where)
        .orderBy(orderBy)
        .limit(query.size)
        .offset(query.page * query.size),
      this.db.select({ value: count() }).from(featureFlag).where(where),
    ]);

    const total = totals[0]?.value ?? 0;
    return {
      items: rows.map((row) => toDto(row.flag, Number(row.overrideCount))),
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

    const [counted] = await this.db
      .select({ value: count() })
      .from(featureFlagOverride)
      .where(eq(featureFlagOverride.flagKey, key));

    return toDto(row, counted?.value ?? 0);
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
          rolloutPercent: input.rolloutPercent ?? 0,
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
    return toDto(created as FlagRow, 0);
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
          ...(input.rolloutPercent !== undefined ? { rolloutPercent: input.rolloutPercent } : {}),
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
  async listOverrides(key: string): Promise<FeatureFlagOverride[]> {
    await this.getByKey(key);

    const rows = await this.db
      .select({
        override: featureFlagOverride,
        organizationName: organization.name,
        userEmail: user.email,
      })
      .from(featureFlagOverride)
      .leftJoin(organization, eq(organization.id, featureFlagOverride.organizationId))
      .leftJoin(user, eq(user.id, featureFlagOverride.userId))
      .where(eq(featureFlagOverride.flagKey, key))
      .orderBy(desc(featureFlagOverride.createdAt));

    return rows.map((row) => ({
      id: row.override.id,
      flagKey: row.override.flagKey,
      organizationId: row.override.organizationId,
      organizationName: row.organizationName ?? null,
      userId: row.override.userId,
      userEmail: row.userEmail ?? null,
      enabled: row.override.enabled,
      createdAt: row.override.createdAt.toISOString(),
    }));
  }

  async setOverride(
    actor: PlatformActor,
    key: string,
    input: FeatureFlagOverrideCreate,
  ): Promise<FeatureFlagOverride> {
    await this.getByKey(key);

    const organizationId = input.organizationId ?? null;
    const userId = input.userId ?? null;

    // The subject must exist. Without this an override can be written against a typo,
    // and it would sit in the list forever doing nothing anybody could explain.
    if (organizationId) {
      const [row] = await this.db
        .select({ id: organization.id })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1);
      if (!row) throw AppException.notFound('Organization', ERROR_CODES.ORGANIZATION_NOT_FOUND);
    } else if (userId) {
      const [row] = await this.db
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
      if (!row) throw AppException.notFound('User');
    }

    const id = await this.db.transaction(async (tx) => {
      const subject = organizationId
        ? and(
            eq(featureFlagOverride.flagKey, key),
            eq(featureFlagOverride.organizationId, organizationId),
          )
        : and(eq(featureFlagOverride.flagKey, key), eq(featureFlagOverride.userId, userId ?? ''));

      const [existing] = await tx
        .select({ id: featureFlagOverride.id, enabled: featureFlagOverride.enabled })
        .from(featureFlagOverride)
        .where(subject)
        .limit(1);

      /**
       * An existing override is updated rather than rejected. The administrator asked
       * for "this subject, this answer"; refusing with a conflict and making them
       * delete the old row first would be pedantry, and the partial unique indexes
       * would refuse the insert anyway.
       */
      if (existing) {
        await tx
          .update(featureFlagOverride)
          .set({ enabled: input.enabled, updatedAt: new Date() })
          .where(eq(featureFlagOverride.id, existing.id));

        await this.audit.record(
          {
            organizationId: null,
            actorUserId: actor.userId,
            action: 'flag.override.updated',
            resourceType: 'feature_flag_override',
            resourceId: existing.id,
            before: { flagKey: key, organizationId, userId, enabled: existing.enabled },
            after: { flagKey: key, organizationId, userId, enabled: input.enabled },
          },
          tx,
        );

        return existing.id;
      }

      const [created] = await tx
        .insert(featureFlagOverride)
        .values({ flagKey: key, organizationId, userId, enabled: input.enabled })
        .returning({ id: featureFlagOverride.id });

      await this.audit.record(
        {
          organizationId: null,
          actorUserId: actor.userId,
          action: 'flag.override.created',
          resourceType: 'feature_flag_override',
          resourceId: created?.id ?? null,
          after: { flagKey: key, organizationId, userId, enabled: input.enabled },
        },
        tx,
      );

      return created?.id ?? '';
    });

    this.invalidate();

    const overrides = await this.listOverrides(key);
    const saved = overrides.find((o) => o.id === id);
    if (!saved) throw AppException.notFound('Feature flag override');
    return saved;
  }

  async removeOverride(actor: PlatformActor, key: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(featureFlagOverride)
        .where(and(eq(featureFlagOverride.id, id), eq(featureFlagOverride.flagKey, key)))
        .limit(1);
      if (!before) throw AppException.notFound('Feature flag override');

      await tx.delete(featureFlagOverride).where(eq(featureFlagOverride.id, id));

      await this.audit.record(
        {
          organizationId: null,
          actorUserId: actor.userId,
          action: 'flag.override.deleted',
          resourceType: 'feature_flag_override',
          resourceId: id,
          before,
        },
        tx,
      );
    });

    this.invalidate();
  }

  /**
   * Drops every cached answer.
   *
   * Coarse on purpose: a flag change is rare and a resolution is two cheap queries, so
   * the simple thing that cannot be wrong beats working out which subjects an override
   * could possibly have affected.
   */
  private invalidate(): void {
    this.cache.clear();
  }

  private async loadOverridesFor(
    subject: FlagSubject,
  ): Promise<(typeof featureFlagOverride.$inferSelect)[]> {
    const conditions: SQL[] = [];
    if (subject.userId) conditions.push(eq(featureFlagOverride.userId, subject.userId));
    if (subject.organizationId) {
      conditions.push(eq(featureFlagOverride.organizationId, subject.organizationId));
    }
    if (conditions.length === 0) return [];

    return this.db
      .select()
      .from(featureFlagOverride)
      .where(conditions.length === 1 ? conditions[0] : or(...conditions));
  }

  private resolveOne(
    flag: FlagRow,
    subject: FlagSubject,
    overrides: readonly (typeof featureFlagOverride.$inferSelect)[],
  ): boolean {
    const forUser = overrides.find(
      (o) => o.flagKey === flag.key && o.userId !== null && o.userId === subject.userId,
    );
    if (forUser) return forUser.enabled;

    const forOrg = overrides.find(
      (o) =>
        o.flagKey === flag.key &&
        o.organizationId !== null &&
        o.organizationId === subject.organizationId,
    );
    if (forOrg) return forOrg.enabled;

    if (flag.enabled) return true;
    if (flag.rolloutPercent <= 0) return false;

    // The organization first: a gradual rollout that split the members of one tenant
    // would have half a team describing a different product to the other half.
    const bucketOn = subject.organizationId ?? subject.userId;
    if (!bucketOn) return false;

    return bucket(flag.key, bucketOn) < flag.rolloutPercent;
  }
}

/**
 * A stable number in [0, 100) for a flag and a subject.
 *
 * Stable across processes and restarts, which is the whole point: the same tenant must
 * stay on the same side of the line for as long as the percentage does not move.
 */
export function bucket(flagKey: string, subjectId: string): number {
  const digest = createHash('sha256').update(`${flagKey}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function toDto(row: FlagRow, overrideCount: number): FeatureFlag {
  return {
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    rolloutPercent: row.rolloutPercent,
    overrideCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
