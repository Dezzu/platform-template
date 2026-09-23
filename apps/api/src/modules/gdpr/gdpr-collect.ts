import { desc, eq } from 'drizzle-orm';
import {
  account,
  auditLog,
  deletionRequest,
  emailMessage,
  file,
  gdprExportRequest,
  invitation,
  member,
  notification,
  notificationPreference,
  organization,
  project,
  session,
  subscription,
  user,
  type Database,
} from '@app/db';

/**
 * What goes into an archive, and — more importantly — what does not.
 *
 * Article 15 is a right to *your data*, not to the contents of the database. Three
 * things are excluded on purpose and the exclusions are as much a part of this file as
 * the queries:
 *
 *  - **credentials**: the password hash, OAuth access and refresh tokens, the TOTP
 *    secret and the backup codes. They are not information about a person, they are
 *    the means of becoming them, and an archive that carried them would turn a
 *    download link into an account takeover.
 *  - **session tokens**, for the same reason. The session's IP address, user agent and
 *    times *are* personal data and are included; the token is not.
 *  - **other people's data**, in a personal export. A membership names the
 *    organization; it does not enumerate the colleagues.
 *
 * An organization export is the mirror image: it is asked for by somebody holding
 * `gdpr.export` and it does name the members, because that is what a controller
 * exporting their own tenant needs.
 */

/** Shape of an archive. JSON, versioned, with enough metadata to be self-explanatory. */
export interface ExportArchive {
  meta: {
    /** Bumped when the layout changes, so an old archive stays readable. */
    format: 1;
    scope: 'user' | 'organization';
    subjectId: string;
    generatedAt: string;
    application: string;
    /**
     * Said in the file itself rather than only in the policy: somebody reading an
     * archive should not have to guess whether the absence of a password means it was
     * never set.
     */
    excluded: readonly string[];
  };
  data: Record<string, unknown>;
}

const EXCLUDED = [
  'password hashes and OAuth tokens',
  'two-factor secrets and backup codes',
  'session tokens',
] as const;

/** Everything one person is entitled to a copy of. */
export async function collectUserData(
  db: Database,
  userId: string,
): Promise<ExportArchive['data']> {
  const [profile] = await db.select().from(user).where(eq(user.id, userId)).limit(1);

  const [
    accounts,
    sessions,
    memberships,
    notifications,
    preferences,
    entries,
    mail,
    exports,
    erasures,
  ] = await Promise.all([
    db.select().from(account).where(eq(account.userId, userId)),
    db.select().from(session).where(eq(session.userId, userId)),
    db
      .select({
        organizationId: member.organizationId,
        organizationName: organization.name,
        role: member.role,
        joinedAt: member.createdAt,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(eq(member.userId, userId)),
    db
      .select()
      .from(notification)
      .where(eq(notification.userId, userId))
      .orderBy(desc(notification.createdAt)),
    db.select().from(notificationPreference).where(eq(notificationPreference.userId, userId)),
    db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorUserId, userId))
      .orderBy(desc(auditLog.createdAt)),
    db
      .select()
      .from(emailMessage)
      .where(eq(emailMessage.userId, userId))
      .orderBy(desc(emailMessage.createdAt)),
    db.select().from(gdprExportRequest).where(eq(gdprExportRequest.userId, userId)),
    db.select().from(deletionRequest).where(eq(deletionRequest.requestedByUserId, userId)),
  ]);

  return {
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          email: profile.email,
          emailVerified: profile.emailVerified,
          image: profile.image,
          role: profile.role,
          twoFactorEnabled: profile.twoFactorEnabled,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
        }
      : null,

    /** Which providers this account signs in with. Never the secrets behind them. */
    loginMethods: accounts.map((row) => ({
      provider: row.providerId,
      hasPassword: row.password !== null,
      createdAt: row.createdAt,
    })),

    sessions: sessions.map((row) => ({
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
    })),

    memberships,
    notifications,
    notificationPreferences: preferences,
    activity: entries,
    emails: mail,
    exportRequests: exports,
    deletionRequests: erasures,
  };
}

/** Everything one tenant holds, for whoever is accountable for it. */
export async function collectOrganizationData(
  db: Database,
  organizationId: string,
): Promise<ExportArchive['data']> {
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const [members, invitations, projects, files, entries, mail, notifications, subscriptions] =
    await Promise.all([
      db
        .select({
          userId: member.userId,
          name: user.name,
          email: user.email,
          role: member.role,
          joinedAt: member.createdAt,
        })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, organizationId)),
      db.select().from(invitation).where(eq(invitation.organizationId, organizationId)),
      db.select().from(project).where(eq(project.organizationId, organizationId)),
      // Metadata only: the objects themselves stay in the bucket, where their owner
      // can already download each one through a presigned URL.
      db.select().from(file).where(eq(file.organizationId, organizationId)),
      db
        .select()
        .from(auditLog)
        .where(eq(auditLog.organizationId, organizationId))
        .orderBy(desc(auditLog.createdAt)),
      db.select().from(emailMessage).where(eq(emailMessage.organizationId, organizationId)),
      db.select().from(notification).where(eq(notification.organizationId, organizationId)),
      /**
       * Billing state, not invoices. The invoices live at Stripe and are kept there for
       * the decade Italian law asks for — see docs/gdpr.md on why "delete everything"
       * is the wrong answer for fiscal documents.
       */
      db.select().from(subscription).where(eq(subscription.referenceId, organizationId)),
    ]);

  return {
    organization: org ?? null,
    members,
    invitations,
    projects,
    files,
    activity: entries,
    emails: mail,
    notifications,
    subscriptions,
  };
}

export function buildArchive(input: {
  scope: 'user' | 'organization';
  subjectId: string;
  application: string;
  data: ExportArchive['data'];
}): ExportArchive {
  return {
    meta: {
      format: 1,
      scope: input.scope,
      subjectId: input.subjectId,
      generatedAt: new Date().toISOString(),
      application: input.application,
      excluded: EXCLUDED,
    },
    data: input.data,
  };
}
