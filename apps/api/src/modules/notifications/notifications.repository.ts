import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import { notification, type Database } from '@app/db';
import { DRIZZLE } from '../../database/database.module';
import type { OrgScope } from '../../database/tenant.repository';

type NotificationRow = typeof notification.$inferSelect;

/** Everything a read path needs to know about who is asking. */
export interface RecipientScope extends OrgScope {
  readonly userId: string;
}

/**
 * Scoped to the **recipient** first and to the organization second — which is why this
 * is the one repository that does not extend `TenantRepository`.
 *
 * That base class exists to make the unscoped query the awkward one to write, and it
 * does it by demanding an `OrgScope` and welding `organization_id = ?` onto everything.
 * A notification no longer fits: `organization_id` is **nullable**, because "la copia
 * dei tuoi dati è pronta" is a fact about a person rather than about a tenant, and a
 * welded tenant predicate would hide it from everybody — including from anyone who
 * belongs to no organization at all.
 *
 * So the same job is done one level in: `visibleTo` is the single place the predicate
 * is written, every read here goes through it, and it is **stricter** than the base
 * class was, not looser. The tenant half widens to "this tenant, or no tenant"; the
 * recipient half (`user_id`) is unconditional, and that is what actually keeps one
 * member out of another's mail. There is no method on this class that can be called
 * without it.
 */
@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * What this person may see in this tenant.
   *
   * Returned as a single `SQL` rather than as a list of clauses: `and()` widens to
   * `SQL | undefined`, which `exactOptionalPropertyTypes` then refuses to pass as an
   * optional `where` — and a caller assembling the two halves itself is exactly the
   * mistake this method exists to make impossible.
   */
  visibleTo(scope: RecipientScope, ...extra: (SQL | undefined)[]): SQL {
    return and(
      eq(notification.userId, scope.userId),
      or(
        eq(notification.organizationId, scope.organizationId),
        isNull(notification.organizationId),
      ),
      ...extra.filter((clause): clause is SQL => clause !== undefined),
    ) as SQL;
  }

  async findMany(
    scope: RecipientScope,
    options: { where?: SQL; orderBy?: SQL; limit?: number; offset?: number } = {},
  ): Promise<NotificationRow[]> {
    let query = this.db
      .select()
      .from(notification)
      .where(this.visibleTo(scope, options.where))
      .$dynamic();

    if (options.orderBy) query = query.orderBy(options.orderBy);
    if (options.limit !== undefined) query = query.limit(options.limit);
    if (options.offset !== undefined) query = query.offset(options.offset);

    return query;
  }

  async count(scope: RecipientScope, where?: SQL): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)::int` })
      .from(notification)
      .where(this.visibleTo(scope, where));

    return Number(rows[0]?.value ?? 0);
  }

  /**
   * Returns undefined for a row that does not exist *and* for one addressed to
   * somebody else — indistinguishable on purpose, so the controller answers 404 either
   * way and never confirms that another person's id exists.
   */
  async findById(scope: RecipientScope, id: string): Promise<NotificationRow | undefined> {
    const rows = await this.db
      .select()
      .from(notification)
      .where(this.visibleTo(scope, eq(notification.id, id)))
      .limit(1);

    return rows[0];
  }

  /** Marks everything this person has unread here. Returns how many moved. */
  async markAllRead(scope: RecipientScope): Promise<number> {
    const now = new Date();
    const updated = await this.db
      .update(notification)
      .set({ readAt: now, updatedAt: now })
      .where(this.visibleTo(scope, isNull(notification.readAt)))
      .returning({ id: notification.id });

    return updated.length;
  }

  /** Idempotent: reading something twice does not move the moment it was first read. */
  async markRead(scope: RecipientScope, id: string): Promise<NotificationRow | undefined> {
    const rows = await this.db
      .update(notification)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(this.visibleTo(scope, eq(notification.id, id), isNull(notification.readAt)))
      .returning();

    return rows[0];
  }
}
