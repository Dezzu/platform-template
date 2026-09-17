import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, or, sql, type SQL } from 'drizzle-orm';
import {
  ERROR_CODES,
  platformOutranksOrEquals,
  type AdminBan,
  type AdminUser,
  type AdminUserDetail,
  type AdminUserListQuery,
  type OrgRole,
  type Paginated,
  type PlatformRole,
} from '@app/contracts';
import { member, organization, session, user, type Database } from '@app/db';
import { auth } from '../../auth/auth.config';
import { callAuthApi } from '../../auth/better-auth.bridge';
import { AppException } from '../../common';
import { DRIZZLE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';

/** Who is asking, and what platform role they hold. */
export interface PlatformActor {
  userId: string;
  role: string;
  /** The caller's own headers, so Better Auth's checks run as them and not as nobody. */
  headers: Headers;
}

type UserRow = typeof user.$inferSelect;

/**
 * Every account on the platform, across tenants.
 *
 * Reads are ours — the interesting columns are on `user` and the counts are joins.
 * State changes go through Better Auth's admin API, because banning has to invalidate
 * sessions and a reset link has to be a real token, and both are its business.
 *
 * The rules that matter here are about rank, not permission. `platform.users.manage`
 * says an admin may change roles; it does not say *whose*, and read literally it lets
 * an admin grant themselves superadmin. `assertMayActOn` and `assertMayGrant` are what
 * keep `admin` and `superadmin` from being the same role.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async list(query: AdminUserListQuery): Promise<Paginated<AdminUser>> {
    const filters: (SQL | undefined)[] = [
      query.q ? or(ilike(user.name, `%${query.q}%`), ilike(user.email, `%${query.q}%`)) : undefined,
      query.role ? eq(user.role, query.role) : undefined,
      query.banned === undefined ? undefined : eq(user.banned, query.banned),
    ];
    const where = and(...filters.filter((f): f is SQL => f !== undefined));

    const organizationCount = this.db
      .select({ value: count() })
      .from(member)
      .where(eq(member.userId, user.id));

    /**
     * Only these three columns are sortable, and the list is closed on purpose: the
     * sort field arrives from the client, and passing it to the query builder unchecked
     * is how an ORDER BY becomes an injection point. Anything else falls back to the
     * default, which is what an unsorted admin list should be — newest first.
     */
    const sortable = { name: user.name, email: user.email, createdAt: user.createdAt };
    const column =
      query.sort && query.sort in sortable
        ? sortable[query.sort as keyof typeof sortable]
        : undefined;
    const orderBy = column
      ? query.dir === 'asc'
        ? asc(column)
        : desc(column)
      : desc(user.createdAt);

    /**
     * Scoping to one organization turns the query into a join on membership, which is
     * also what makes the org role available — the only place it has a meaning. Without
     * a filter there is no single role to report and the column stays null.
     */
    const scoped = query.organizationId;

    const [rows, totals] = await Promise.all([
      scoped
        ? this.db
            .select({
              user,
              organizationCount: sql<number>`(${organizationCount})`,
              organizationRole: member.role,
            })
            .from(user)
            .innerJoin(member, eq(member.userId, user.id))
            .where(and(eq(member.organizationId, scoped), where))
            .orderBy(orderBy)
            .limit(query.size)
            .offset(query.page * query.size)
        : this.db
            .select({
              user,
              organizationCount: sql<number>`(${organizationCount})`,
              organizationRole: sql<string | null>`null`,
            })
            .from(user)
            .where(where)
            .orderBy(orderBy)
            .limit(query.size)
            .offset(query.page * query.size),
      scoped
        ? this.db
            .select({ value: count() })
            .from(user)
            .innerJoin(member, eq(member.userId, user.id))
            .where(and(eq(member.organizationId, scoped), where))
        : this.db.select({ value: count() }).from(user).where(where),
    ]);

    const total = Number(totals[0]?.value ?? 0);

    return {
      items: rows.map((row) =>
        toDto(row.user, Number(row.organizationCount), row.organizationRole),
      ),
      meta: {
        page: query.page,
        size: query.size,
        total,
        totalPages: Math.ceil(total / query.size),
      },
    };
  }

  async getById(userId: string): Promise<AdminUserDetail> {
    const row = await this.load(userId);

    const [organizations, sessions] = await Promise.all([
      this.db
        .select({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          role: member.role,
        })
        .from(member)
        .innerJoin(organization, eq(member.organizationId, organization.id))
        .where(eq(member.userId, userId)),
      this.db
        .select({ value: count() })
        .from(session)
        .where(and(eq(session.userId, userId), gt(session.expiresAt, new Date()))),
    ]);

    return {
      ...toDto(row, organizations.length),
      organizations: organizations.map((org) => ({
        id: org.id,
        name: org.name,
        slug: org.slug,
        role: org.role as OrgRole,
      })),
      activeSessions: Number(sessions[0]?.value ?? 0),
    };
  }

  async setRole(actor: PlatformActor, userId: string, role: PlatformRole): Promise<AdminUser> {
    const target = await this.load(userId);

    /**
     * Changing your own platform role is refused outright.
     *
     * Not symmetry with the organization rules, but a lockout: only a superadmin can
     * grant superadmin, so the last one demoting themselves leaves a platform where
     * nobody can ever be promoted again — recoverable only with a SQL console.
     */
    if (userId === actor.userId) {
      throw new AppException(
        ERROR_CODES.CANNOT_MODIFY_SELF,
        HttpStatus.CONFLICT,
        'You cannot change your own platform role',
      );
    }

    this.assertMayActOn(actor, target);
    this.assertMayGrant(actor, role);

    await callAuthApi(() => auth.api.setRole({ body: { userId, role }, headers: actor.headers }));

    await this.audit.record({
      // Null: this belongs to no tenant. It is the platform acting.
      organizationId: null,
      actorUserId: actor.userId,
      action: 'platform.user.role_changed',
      resourceType: 'user',
      resourceId: userId,
      before: { role: target.role, email: target.email },
      after: { role },
    });

    return toDto({ ...target, role }, await this.countOrganizations(userId));
  }

  /**
   * Sends the account a reset link.
   *
   * Deliberately NOT "set a new password for them": an administrator who can choose
   * someone's password can sign in as them and leave an audit trail that says the user
   * did it. A link puts the new secret only in the account owner's hands.
   */
  async sendPasswordReset(actor: PlatformActor, userId: string, redirectTo: string): Promise<void> {
    const target = await this.load(userId);
    this.assertMayActOn(actor, target);

    await callAuthApi(() =>
      auth.api.requestPasswordReset({
        body: { email: target.email, redirectTo },
        headers: actor.headers,
      }),
    );

    await this.audit.record({
      organizationId: null,
      actorUserId: actor.userId,
      action: 'platform.user.password_reset_sent',
      resourceType: 'user',
      resourceId: userId,
      after: { email: target.email },
    });
  }

  /**
   * Re-sends the address confirmation.
   *
   * The common support case by far: someone signed up, the email went to spam, and
   * they cannot get in. Nothing is changed here — the account stays unverified until
   * the person clicks, which is the whole point of verifying.
   */
  async sendVerificationEmail(
    actor: PlatformActor,
    userId: string,
    callbackURL: string,
  ): Promise<void> {
    const target = await this.load(userId);
    this.assertMayActOn(actor, target);

    if (target.emailVerified) {
      throw new AppException(
        ERROR_CODES.CONFLICT,
        HttpStatus.CONFLICT,
        'This address is already verified',
      );
    }

    /**
     * The one call here made WITHOUT the caller's headers, against the rule the rest of
     * this file follows.
     *
     * With a session Better Auth requires the address to be the session's own — it is
     * built for "resend mine", and an administrator asking on someone else's behalf is
     * rejected as an email mismatch. Without one it simply sends, which is fine: the
     * endpoint is public, anyone may ask for a verification link to any address, and
     * the link only ever reaches the mailbox that owns it. The authorisation that
     * matters is ours, above.
     */
    await callAuthApi(() =>
      auth.api.sendVerificationEmail({
        body: { email: target.email, callbackURL },
        headers: new Headers(),
      }),
    );

    await this.audit.record({
      organizationId: null,
      actorUserId: actor.userId,
      action: 'platform.user.verification_email_sent',
      resourceType: 'user',
      resourceId: userId,
      after: { email: target.email },
    });
  }

  async ban(actor: PlatformActor, userId: string, input: AdminBan): Promise<void> {
    const target = await this.load(userId);

    if (userId === actor.userId) {
      throw new AppException(
        ERROR_CODES.CANNOT_MODIFY_SELF,
        HttpStatus.CONFLICT,
        'You cannot ban yourself',
      );
    }
    this.assertMayActOn(actor, target);

    await callAuthApi(() =>
      auth.api.banUser({
        body: {
          userId,
          banReason: input.reason,
          ...(input.expiresAt
            ? {
                banExpiresIn: Math.max(
                  1,
                  Math.round((Date.parse(input.expiresAt) - Date.now()) / 1000),
                ),
              }
            : {}),
        },
        headers: actor.headers,
      }),
    );

    await this.audit.record({
      organizationId: null,
      actorUserId: actor.userId,
      action: 'platform.user.banned',
      resourceType: 'user',
      resourceId: userId,
      after: { reason: input.reason, expiresAt: input.expiresAt ?? null, email: target.email },
    });
  }

  async unban(actor: PlatformActor, userId: string): Promise<void> {
    const target = await this.load(userId);
    this.assertMayActOn(actor, target);

    await callAuthApi(() => auth.api.unbanUser({ body: { userId }, headers: actor.headers }));

    await this.audit.record({
      organizationId: null,
      actorUserId: actor.userId,
      action: 'platform.user.unbanned',
      resourceType: 'user',
      resourceId: userId,
      after: { email: target.email },
    });
  }

  /** Signs the account out everywhere — the first thing to do about a stolen laptop. */
  async revokeSessions(actor: PlatformActor, userId: string): Promise<void> {
    const target = await this.load(userId);
    this.assertMayActOn(actor, target);

    await callAuthApi(() =>
      auth.api.revokeUserSessions({ body: { userId }, headers: actor.headers }),
    );

    await this.audit.record({
      organizationId: null,
      actorUserId: actor.userId,
      action: 'platform.user.sessions_revoked',
      resourceType: 'user',
      resourceId: userId,
      after: { email: target.email },
    });
  }

  private async load(userId: string): Promise<UserRow> {
    const [row] = await this.db.select().from(user).where(eq(user.id, userId)).limit(1);
    if (!row) throw AppException.notFound('User');
    return row;
  }

  private async countOrganizations(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(member)
      .where(eq(member.userId, userId));
    return Number(row?.value ?? 0);
  }

  private assertMayActOn(actor: PlatformActor, target: UserRow): void {
    if (platformOutranksOrEquals(actor.role, target.role ?? 'user')) return;
    throw AppException.forbidden(`A ${actor.role} cannot act on a ${target.role}`);
  }

  private assertMayGrant(actor: PlatformActor, granted: string): void {
    if (platformOutranksOrEquals(actor.role, granted)) return;
    throw new AppException(
      ERROR_CODES.CANNOT_GRANT_HIGHER_ROLE,
      HttpStatus.FORBIDDEN,
      `A ${actor.role} cannot grant the platform role ${granted}`,
    );
  }
}

function toDto(
  row: UserRow,
  organizationCount: number,
  organizationRole: string | null = null,
): AdminUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    image: row.image,
    emailVerified: row.emailVerified,
    twoFactorEnabled: row.twoFactorEnabled ?? false,
    role: row.role,
    banned: row.banned ?? false,
    banReason: row.banReason,
    banExpires: row.banExpires?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    organizationCount,
    organizationRole: (organizationRole as AdminUser['organizationRole']) ?? null,
  };
}
