import { and, eq, sql, type InferInsertModel, type InferSelectModel, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database, DbOrTx } from '@app/db';

/** Anything carrying the tenant id. OrgContext satisfies this. */
export interface OrgScope {
  readonly organizationId: string;
}

/** A domain table: has an id and belongs to exactly one organization. */
export type TenantTable = PgTable & {
  id: PgColumn;
  organizationId: PgColumn;
};

/**
 * Base class for every repository over an organization-scoped table.
 *
 * The point is not convenience, it is that **the unscoped query is the awkward one to
 * write**. Every method here demands an OrgScope, which only PermissionsGuard produces,
 * so a handler cannot accidentally query across tenants — and cannot take the
 * organization id from a request body or path parameter, which is how cross-tenant
 * reads normally happen.
 *
 * Reaching for `this.db` directly inside a subclass bypasses all of this. If you need
 * a query this class does not cover, build it with `this.scoped(scope, extra)` so the
 * tenant predicate is still applied.
 *
 * Note that a missing row and a row belonging to another tenant are indistinguishable
 * from the caller's point of view: both return undefined, so the controller answers
 * 404 either way and never confirms that someone else's id exists.
 */
export abstract class TenantRepository<T extends TenantTable> {
  protected constructor(
    protected readonly db: Database,
    protected readonly table: T,
  ) {}

  /** The tenant predicate, optionally combined with more conditions. */
  protected scoped(scope: OrgScope, ...extra: (SQL | undefined)[]): SQL {
    const conditions = [eq(this.table.organizationId, scope.organizationId), ...extra].filter(
      (c): c is SQL => c !== undefined,
    );
    // `and()` returns undefined only for an empty list, and the tenant predicate is
    // always present, so the assertion is safe.
    return and(...conditions) as SQL;
  }

  protected conn(tx?: DbOrTx): DbOrTx {
    return tx ?? this.db;
  }

  async findById(
    scope: OrgScope,
    id: string,
    tx?: DbOrTx,
  ): Promise<InferSelectModel<T> | undefined> {
    const rows = await (this.conn(tx) as Database)
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(scope, eq(this.table.id, id)))
      .limit(1);
    return rows[0] as InferSelectModel<T> | undefined;
  }

  async findMany(
    scope: OrgScope,
    options: { where?: SQL; orderBy?: SQL; limit?: number; offset?: number } = {},
    tx?: DbOrTx,
  ): Promise<InferSelectModel<T>[]> {
    let query = (this.conn(tx) as Database)
      .select()
      .from(this.table as PgTable)
      .where(this.scoped(scope, options.where))
      .$dynamic();

    if (options.orderBy) query = query.orderBy(options.orderBy);
    if (options.limit !== undefined) query = query.limit(options.limit);
    if (options.offset !== undefined) query = query.offset(options.offset);

    return (await query) as InferSelectModel<T>[];
  }

  async count(scope: OrgScope, where?: SQL, tx?: DbOrTx): Promise<number> {
    const rows = await (this.conn(tx) as Database)
      .select({ value: sql<number>`count(*)` })
      .from(this.table as PgTable)
      .where(this.scoped(scope, where));
    return Number(rows[0]?.value ?? 0);
  }

  /**
   * Inserts with the tenant id forced from the scope. A caller-supplied
   * organizationId in `values` is overwritten on purpose — it is never trustworthy.
   */
  async insert(
    scope: OrgScope,
    values: Omit<InferInsertModel<T>, 'organizationId'>,
    tx?: DbOrTx,
  ): Promise<InferSelectModel<T>> {
    const rows = await (this.conn(tx) as Database)
      .insert(this.table as PgTable)
      .values({ ...values, organizationId: scope.organizationId } as never)
      .returning();
    return rows[0] as InferSelectModel<T>;
  }

  /** Returns undefined when the row does not exist *or* belongs to another tenant. */
  async update(
    scope: OrgScope,
    id: string,
    values: Partial<Omit<InferInsertModel<T>, 'id' | 'organizationId'>>,
    tx?: DbOrTx,
  ): Promise<InferSelectModel<T> | undefined> {
    const rows = await (this.conn(tx) as Database)
      .update(this.table as PgTable)
      .set(values as never)
      .where(this.scoped(scope, eq(this.table.id, id)))
      .returning();
    return rows[0] as InferSelectModel<T> | undefined;
  }

  /** Returns the deleted row, or undefined when there was nothing to delete here. */
  async delete(scope: OrgScope, id: string, tx?: DbOrTx): Promise<InferSelectModel<T> | undefined> {
    const rows = await (this.conn(tx) as Database)
      .delete(this.table as PgTable)
      .where(this.scoped(scope, eq(this.table.id, id)))
      .returning();
    return rows[0] as InferSelectModel<T> | undefined;
  }
}
