import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  type AdminOrganization,
  type AdminOrganizationDetail,
  type AdminOrganizationListQuery,
  type OrgRole,
  type Paginated,
} from '@app/contracts';
import { member, organization, subscription, user, type Database } from '@app/db';
import { AppException } from '../../common';
import { DRIZZLE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { PlatformActor } from './admin-users.service';

type OrganizationRow = typeof organization.$inferSelect;

/** The plan an organization is on, or nothing. */
interface PlanSnapshot {
  plan: string;
  status: string;
  periodEnd: string | null;
}

/**
 * Every organization on the platform, and the one thing support actually needs to
 * change inside one: who holds which role.
 *
 * The organization itself stays read-only. Deleting a tenant from a support screen is
 * one mis-click away from deleting a customer's data, and nothing about "list the
 * organizations" implies being able to remove one.
 */
@Injectable()
export class AdminOrganizationsService {
  constructor(
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async list(query: AdminOrganizationListQuery): Promise<Paginated<AdminOrganization>> {
    const filters: (SQL | undefined)[] = [
      query.q ? ilike(organization.name, `%${query.q}%`) : undefined,
    ];
    const where = and(...filters.filter((f): f is SQL => f !== undefined));

    const memberCount = this.db
      .select({ value: count() })
      .from(member)
      .where(eq(member.organizationId, organization.id));

    // A closed list, like the users one: the sort field comes from the client, and an
    // ORDER BY built from caller input is an injection point. `memberCount` is absent
    // on purpose — it is a correlated subquery, not a column.
    const sortable = { name: organization.name, createdAt: organization.createdAt };
    const column =
      query.sort && query.sort in sortable
        ? sortable[query.sort as keyof typeof sortable]
        : undefined;
    const orderBy = column
      ? query.dir === 'asc'
        ? asc(column)
        : desc(column)
      : desc(organization.createdAt);

    const [rows, totals] = await Promise.all([
      this.db
        .select({ organization, memberCount: sql<number>`(${memberCount})` })
        .from(organization)
        .where(where)
        .orderBy(orderBy)
        .limit(query.size)
        .offset(query.page * query.size),
      this.db.select({ value: count() }).from(organization).where(where),
    ]);

    // One query for every plan on the page rather than one per row.
    const plans = await this.plansFor(rows.map((row) => row.organization.id));
    const total = Number(totals[0]?.value ?? 0);

    return {
      items: rows.map((row) =>
        toDto(row.organization, Number(row.memberCount), plans.get(row.organization.id) ?? null),
      ),
      meta: {
        page: query.page,
        size: query.size,
        total,
        totalPages: Math.ceil(total / query.size),
      },
    };
  }

  async getById(organizationId: string): Promise<AdminOrganizationDetail> {
    const [row] = await this.db
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);

    if (!row) throw AppException.notFound('Organization');

    const members = await this.db
      .select({
        id: member.id,
        role: member.role,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .where(eq(member.organizationId, organizationId));

    const plans = await this.plansFor([organizationId]);

    return {
      ...toDto(row, members.length, plans.get(organizationId) ?? null),
      members: members.map((m) => ({
        id: m.id,
        role: m.role as OrgRole,
        user: { id: m.userId, name: m.userName, email: m.userEmail },
      })),
    };
  }

  /**
   * Changes a member's role from outside the organization.
   *
   * Written straight to the table rather than through Better Auth, and that is not a
   * shortcut: its endpoints resolve the caller's membership from the session, and a
   * platform administrator has none here. Which is exactly why the last-owner rule has
   * to be enforced in this method — the protection that covers the members screen comes
   * from Better Auth, and none of it is on this path.
   */
  async setMemberRole(
    actor: PlatformActor,
    organizationId: string,
    userId: string,
    role: OrgRole,
  ): Promise<void> {
    const [current] = await this.db
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)))
      .limit(1);

    if (!current) throw AppException.notFound('Member');
    if (current.role === role) return;

    if (current.role === 'owner') {
      const [owners] = await this.db
        .select({ value: count() })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.role, 'owner')));

      // Demoting the last owner leaves a tenant nobody can administer — including
      // nobody who can pay for it.
      if (Number(owners?.value ?? 0) <= 1) {
        throw new AppException(
          ERROR_CODES.ORGANIZATION_LAST_OWNER,
          HttpStatus.CONFLICT,
          'The organization would be left without an owner',
        );
      }
    }

    await this.db.update(member).set({ role }).where(eq(member.id, current.id));

    await this.audit.record({
      // Set, unlike the other platform actions: this one does belong to a tenant, even
      // though the person doing it is not a member of it.
      organizationId,
      actorUserId: actor.userId,
      action: 'platform.member.role_changed',
      resourceType: 'member',
      resourceId: current.id,
      before: { role: current.role, userId },
      after: { role },
    });
  }

  /**
   * `referenceId` is the organization id in `b2b`; in `b2c` it holds a user id and
   * simply will not match, which is why this returns a map rather than assuming a row
   * exists.
   */
  private async plansFor(organizationIds: string[]): Promise<Map<string, PlanSnapshot>> {
    if (organizationIds.length === 0) return new Map();

    const rows = await this.db
      .select()
      .from(subscription)
      .where(inArray(subscription.referenceId, organizationIds));

    const byOrganization = new Map<string, PlanSnapshot>();
    for (const row of rows) {
      // A tenant can have older, ended subscriptions; the live one is what matters.
      const live = row.status === 'active' || row.status === 'trialing';
      if (!live && byOrganization.has(row.referenceId)) continue;

      byOrganization.set(row.referenceId, {
        plan: row.plan,
        status: row.status,
        periodEnd: row.periodEnd?.toISOString() ?? null,
      });
    }
    return byOrganization;
  }
}

function toDto(
  row: OrganizationRow,
  memberCount: number,
  plan: PlanSnapshot | null,
): AdminOrganization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo: row.logo,
    createdAt: row.createdAt.toISOString(),
    memberCount,
    subscription: plan,
  };
}
