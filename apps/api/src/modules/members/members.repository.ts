import { Inject, Injectable } from '@nestjs/common';
import { asc, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { member, user, type Database } from '@app/db';
import { TenantRepository, type OrgScope } from '../../database/tenant.repository';
import { DRIZZLE } from '../../database/database.module';

export interface MemberRow {
  id: string;
  organizationId: string;
  role: string;
  createdAt: Date;
  userId: string;
  userName: string;
  userEmail: string;
  userImage: string | null;
}

/**
 * `member` is a Better Auth table, but it is organization-scoped like any other, so it
 * goes through TenantRepository for the same reason everything else does: the query
 * without the tenant predicate has to be the awkward one to write.
 *
 * The listing needs the user's name and email alongside the membership, which is a
 * join the base class does not cover — so it is built here with `this.scoped()`, which
 * is exactly the escape hatch the base class documents.
 */
@Injectable()
export class MembersRepository extends TenantRepository<typeof member> {
  constructor(@Inject(DRIZZLE) db: Database) {
    super(db, member);
  }

  /** Free-text search across the joined user, since that is what a human types. */
  private searchFilter(term: string | undefined): SQL | undefined {
    if (!term) return undefined;
    return or(ilike(user.name, `%${term}%`), ilike(user.email, `%${term}%`));
  }

  async listWithUsers(
    scope: OrgScope,
    options: {
      role?: string | undefined;
      search?: string | undefined;
      sort?: string | undefined;
      dir: 'asc' | 'desc';
      limit: number;
      offset: number;
    },
  ): Promise<MemberRow[]> {
    const column = options.sort === 'name' ? user.name : member.createdAt;
    const orderBy = options.dir === 'asc' ? asc(column) : desc(column);

    return this.db
      .select({
        id: member.id,
        organizationId: member.organizationId,
        role: member.role,
        createdAt: member.createdAt,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        this.scoped(
          scope,
          options.role ? eq(member.role, options.role) : undefined,
          this.searchFilter(options.search),
        ),
      )
      .orderBy(orderBy)
      .limit(options.limit)
      .offset(options.offset);
  }

  async countWithUsers(
    scope: OrgScope,
    options: { role?: string | undefined; search?: string | undefined },
  ): Promise<number> {
    const rows = await this.db
      .select({ value: sql<number>`count(*)` })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(
        this.scoped(
          scope,
          options.role ? eq(member.role, options.role) : undefined,
          this.searchFilter(options.search),
        ),
      );
    return Number(rows[0]?.value ?? 0);
  }

  /** One membership with its user, scoped to the tenant. */
  async findWithUser(scope: OrgScope, memberId: string): Promise<MemberRow | undefined> {
    const rows = await this.db
      .select({
        id: member.id,
        organizationId: member.organizationId,
        role: member.role,
        createdAt: member.createdAt,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
        userImage: user.image,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(this.scoped(scope, eq(member.id, memberId)))
      .limit(1);

    return rows[0];
  }
}
