import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { eq } from 'drizzle-orm';
import { invitation, organization, user, type Database } from '@app/db';
import {
  ERROR_CODES,
  outranksOrEquals,
  type Invitation,
  type InvitationCreate,
  type InvitationPreview,
  type Member,
  type MemberListQuery,
  type OrgRole,
  type Paginated,
} from '@app/contracts';
import { auth } from '../../auth/auth.config';
import { callAuthApi } from '../../auth/better-auth.bridge';
import { AppException } from '../../common';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { appConfig } from '../../config/namespaces';
import { DRIZZLE } from '../../database/database.module';
import type { OrgContext } from '../../auth/org-context';
import { MembersRepository, type MemberRow } from './members.repository';

/**
 * Membership, split deliberately between two owners.
 *
 * **Reads are ours**: a members list needs the user's name and email next to the role,
 * which is one join, and our pagination and envelope.
 *
 * **Mutations go through Better Auth's server API**, because invitations are its
 * mechanism — the token, the expiry, and the email hook wired in phase 8 all live
 * there, and reimplementing them would mean maintaining a second, worse copy.
 *
 * What is *not* delegated is authorisation. Every method below checks our permission
 * catalogue first (through the guard) and then the rank rules here, before Better Auth
 * is called at all. Its own checks then run on top — belt and braces, in that order.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly repository: MembersRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async list(ctx: OrgContext, query: MemberListQuery): Promise<Paginated<Member>> {
    const options = {
      role: query.role,
      search: query.q,
      sort: query.sort,
      dir: query.dir,
      limit: query.size,
      offset: query.page * query.size,
    };

    const [rows, total] = await Promise.all([
      this.repository.listWithUsers(ctx, options),
      this.repository.countWithUsers(ctx, options),
    ]);

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

  async invite(ctx: OrgContext, headers: Headers, input: InvitationCreate): Promise<Invitation> {
    // You cannot hand out a role you do not hold: otherwise an admin invites an owner
    // and has just promoted themselves by proxy.
    this.assertMayGrant(ctx.role, input.role);

    const created = await callAuthApi(() =>
      auth.api.createInvitation({
        headers,
        body: {
          email: input.email,
          role: input.role,
          // From the resolved context, never from the payload.
          organizationId: ctx.organizationId,
        },
      }),
    );

    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      impersonatorUserId: ctx.impersonatorUserId,
      action: 'member.invited',
      resourceType: 'invitation',
      resourceId: created.id,
      after: { email: input.email, role: input.role },
    });

    return toInvitationDto(created);
  }

  async listInvitations(ctx: OrgContext, headers: Headers): Promise<Invitation[]> {
    const invitations = await callAuthApi(() =>
      auth.api.listInvitations({ headers, query: { organizationId: ctx.organizationId } }),
    );

    // Only the ones still worth acting on; the rest are history nobody asked for.
    return invitations.filter((row) => row.status === 'pending').map((row) => toInvitationDto(row));
  }

  async cancelInvitation(ctx: OrgContext, headers: Headers, invitationId: string): Promise<void> {
    await callAuthApi(() => auth.api.cancelInvitation({ headers, body: { invitationId } }));

    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      impersonatorUserId: ctx.impersonatorUserId,
      action: 'invitation.cancelled',
      resourceType: 'invitation',
      resourceId: invitationId,
    });
  }

  async updateRole(
    ctx: OrgContext,
    headers: Headers,
    memberId: string,
    role: OrgRole,
  ): Promise<Member> {
    const target = await this.loadMember(ctx, memberId);

    this.assertMayActOn(ctx.role, target.role as OrgRole);
    this.assertMayGrant(ctx.role, role);

    /**
     * Changing your OWN role is allowed here, which looks lax and is not: the rank
     * rule above means you can only ever grant a role at or below your own, so the
     * only self-change that gets this far is a demotion. "Step down as owner" is a
     * legitimate thing to want, and refusing it outright would leave no way to do it.
     *
     * Stepping down as the LAST owner is refused — by Better Auth, not here. An
     * earlier version of this method counted owners itself; the count was a query per
     * role change for an invariant the library already enforces, and no test could
     * tell the two apart. What we own is the translation of its code in
     * better-auth.bridge.ts, and the e2e covers exactly that.
     */

    await callAuthApi(() =>
      auth.api.updateMemberRole({
        headers,
        body: { memberId, role, organizationId: ctx.organizationId },
      }),
    );

    const updated = await this.loadMember(ctx, memberId);

    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      impersonatorUserId: ctx.impersonatorUserId,
      action: 'member.role_changed',
      resourceType: 'member',
      resourceId: memberId,
      before: { role: target.role },
      after: { role: updated.role },
    });

    return toDto(updated);
  }

  async remove(ctx: OrgContext, headers: Headers, memberId: string): Promise<void> {
    const target = await this.loadMember(ctx, memberId);

    if (target.userId === ctx.userId) {
      throw new AppException(
        ERROR_CODES.CANNOT_MODIFY_SELF,
        HttpStatus.CONFLICT,
        'You cannot remove yourself; leave the organization instead',
      );
    }

    this.assertMayActOn(ctx.role, target.role as OrgRole);

    await callAuthApi(() =>
      auth.api.removeMember({
        headers,
        body: { memberIdOrEmail: memberId, organizationId: ctx.organizationId },
      }),
    );

    await this.audit.record({
      organizationId: ctx.organizationId,
      actorUserId: ctx.userId,
      impersonatorUserId: ctx.impersonatorUserId,
      action: 'member.removed',
      resourceType: 'member',
      resourceId: memberId,
      before: { role: target.role, userId: target.userId, email: target.userEmail },
    });
  }

  /**
   * The recipient's view of an invitation, before they commit to anything.
   *
   * Not tenant-scoped, and it cannot be: the caller is not a member yet. Better Auth
   * checks that the signed-in address matches the invited one, which is what keeps this
   * from being a way to read any invitation by guessing its id.
   */
  /**
   * What an invitation says, for whoever holds the link — with no session required.
   *
   * Read straight from the tables rather than through `auth.api.getInvitation`,
   * because that call refuses anyone who is not signed in as the invited address —
   * which is precisely the person this has to serve: somebody who has no account yet
   * and is about to create one.
   *
   * Safe because the id is a long random token that was emailed to that address, and
   * because nothing here grants anything: joining still goes through `accept`, which
   * checks that the session's address is the invited one.
   */
  async preview(invitationId: string): Promise<InvitationPreview> {
    const [row] = await this.db
      .select({
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        organizationName: organization.name,
        inviterName: user.name,
        inviterEmail: user.email,
      })
      .from(invitation)
      .innerJoin(organization, eq(organization.id, invitation.organizationId))
      .innerJoin(user, eq(user.id, invitation.inviterId))
      .where(eq(invitation.id, invitationId))
      .limit(1);

    if (!row) throw AppException.notFound('Invitation', ERROR_CODES.INVITATION_NOT_FOUND);

    const [existing] = await this.db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, row.email))
      .limit(1);

    return {
      id: row.id,
      email: row.email,
      // The column is nullable in Better Auth's schema; an invitation without a role
      // is a member invitation.
      role: normaliseRole(row.role ?? 'member'),
      status: row.status as InvitationPreview['status'],
      organizationName: row.organizationName,
      inviterName: row.inviterName?.trim() || row.inviterEmail,
      expiresAt: row.expiresAt.toISOString(),
      accountExists: Boolean(existing),
    };
  }

  async accept(
    userId: string,
    headers: Headers,
    invitationId: string,
  ): Promise<{ organizationId: string }> {
    const result = await callAuthApi(() =>
      auth.api.acceptInvitation({ headers, body: { invitationId } }),
    );

    const organizationId = result?.invitation?.organizationId ?? '';

    await this.audit.record({
      organizationId,
      actorUserId: userId,
      impersonatorUserId: null,
      action: 'invitation.accepted',
      resourceType: 'invitation',
      resourceId: invitationId,
    });

    await this.announceJoin(organizationId, userId);

    return { organizationId };
  }

  /**
   * Tells whoever runs the organization that somebody accepted.
   *
   * Here rather than in a Better Auth hook because this is the endpoint acceptance
   * actually goes through — a hook on the `member` table would also fire for the
   * personal organization created at signup in `b2c`, and the first thing a new user
   * would see is a notification that they joined themselves.
   *
   * Owners and admins only: it is news about the tenant, and the people who can act on
   * it are the people who hold `members.manage`. Never notifies the joiner — they
   * were there when it happened.
   */
  private async announceJoin(organizationId: string, joinedUserId: string): Promise<void> {
    if (!organizationId) return;

    const recipients = (
      await this.notifications.recipientsInRoles(organizationId, ['owner', 'admin'])
    ).filter((id) => id !== joinedUserId);

    const [joined] = await this.db
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, joinedUserId))
      .limit(1);

    const memberName = joined?.name?.trim() || joined?.email || '';
    const organizationName = await this.notifications.organizationName(organizationId);

    await this.notifications.notify({
      organizationId,
      userIds: recipients,
      type: 'member.joined',
      params: { memberName },
      actionUrl: '/members',
      email: {
        organizationName,
        memberName,
        url: `${this.app.dashboardUrl}/members`,
      },
    });
  }

  /** A membership inside the caller's tenant, or 404. */
  private async loadMember(ctx: OrgContext, memberId: string): Promise<MemberRow> {
    // Scoped, so a membership of another organization is indistinguishable from a
    // missing one — the caller gets 404 either way and learns nothing.
    const row = await this.repository.findWithUser(ctx, memberId);
    if (!row) throw AppException.notFound('Member');
    return row;
  }

  private assertMayActOn(actor: OrgRole, target: OrgRole): void {
    if (outranksOrEquals(actor, target)) return;
    throw AppException.forbidden(`A ${actor} cannot act on a ${target}`);
  }

  private assertMayGrant(actor: OrgRole, granted: OrgRole): void {
    if (outranksOrEquals(actor, granted)) return;
    throw new AppException(
      ERROR_CODES.CANNOT_GRANT_HIGHER_ROLE,
      HttpStatus.FORBIDDEN,
      `A ${actor} cannot grant the role ${granted}`,
    );
  }
}

function normaliseRole(role: string | string[]): OrgRole {
  // Better Auth models roles as a string or an array of them; this template uses one.
  const first = Array.isArray(role) ? role[0] : role;
  return (first ?? 'member') as OrgRole;
}

function toDto(row: MemberRow): Member {
  return {
    id: row.id,
    organizationId: row.organizationId,
    role: row.role as OrgRole,
    createdAt: row.createdAt.toISOString(),
    user: {
      id: row.userId,
      name: row.userName,
      email: row.userEmail,
      image: row.userImage,
    },
  };
}

function toInvitationDto(row: {
  id: string;
  organizationId: string;
  email: string;
  role: string | string[];
  status: string;
  expiresAt: Date | string;
  inviterId: string;
}): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: normaliseRole(row.role),
    status: row.status as Invitation['status'],
    expiresAt: new Date(row.expiresAt).toISOString(),
    inviterId: row.inviterId,
  };
}
