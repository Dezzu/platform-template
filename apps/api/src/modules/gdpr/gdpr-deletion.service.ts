import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { and, count, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type DeletionRequest,
  type DeletionRequestCreate,
  type DeletionSubjectType,
} from '@app/contracts';
import {
  auditLog,
  deletionRequest,
  emailMessage,
  file,
  member,
  organization,
  subscription,
  user,
  type Database,
} from '@app/db';
import { AppException } from '../../common';
import { appConfig, gdprConfig } from '../../config/namespaces';
import { DRIZZLE } from '../../database/database.module';
import { JOBS, QUEUES } from '../../queue/queue.constants';
import { S3Service } from '../../storage/s3.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { GdprExportService } from './gdpr-export.service';

type DeletionRow = typeof deletionRequest.$inferSelect;

/**
 * Anything that still bills, or is about to.
 *
 * Wider than ENTITLING_STATUSES on purpose: `past_due` does not entitle anybody to the
 * paid product, but it is still a subscription Stripe will keep trying to charge — and
 * erasing the customer underneath it would leave an invoice with nobody attached.
 */
const BILLING_STATUSES = ['active', 'trialing', 'past_due'] as const;

/** Postgres unique violation. The race the partial unique index exists to lose. */
const UNIQUE_VIOLATION = '23505';

/**
 * Erasure: the thirty days, the states, and what "delete everything" actually means.
 *
 * Three decisions are worth knowing before changing anything here.
 *
 * **It is scheduled, not immediate.** Article 17 does not require erasure within the
 * second, and an account deleted on a misclick is the one mistake in this product that
 * cannot be undone. The grace period is what makes the button safe to offer.
 *
 * **An account is erased, an organization's records are not.** Deleting the `user` row
 * cascades through sessions, credentials, memberships and notifications; what survives
 * is the audit trail, whose actor becomes null and whose email snapshot is scrubbed
 * here. That is deliberate: "who changed this setting" must stay answerable, and a
 * null actor answers it as well as a name did while telling you nothing about a person.
 *
 * **Money stops it.** A subject that still has a live subscription is not erased — see
 * `awaiting_billing` and ERROR_CODES.GDPR_DELETION_BLOCKED_BY_SUBSCRIPTION. Cancelling
 * somebody's subscription for them would be this service moving money on its own, and
 * deleting a paying tenant because a job fell due would be worse.
 */
@Injectable()
export class GdprDeletionService {
  private readonly logger = new Logger(GdprDeletionService.name);

  constructor(
    @InjectQueue(QUEUES.GDPR) private readonly queue: Queue,
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly s3: S3Service,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly exports: GdprExportService,
    @Inject(gdprConfig.KEY) private readonly config: ConfigType<typeof gdprConfig>,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async schedule(
    actor: { id: string; email: string; name: string },
    subjectType: DeletionSubjectType,
    input: DeletionRequestCreate,
    organizationId: string | null,
  ): Promise<DeletionRequest> {
    const subjectId = subjectType === 'user' ? actor.id : (organizationId ?? '');
    if (!subjectId) throw AppException.notFound('Organization');

    if (subjectType === 'user') await this.assertAccountErasable(actor.id);
    else await this.assertOrganizationErasable(subjectId);

    const scheduledFor = new Date(Date.now() + this.config.deletionGraceDays * 86_400_000);

    const row = await this.insertOpen({
      subjectType,
      subjectId,
      requestedByUserId: actor.id,
      scheduledFor,
      reason: input.reason ?? null,
    });

    await this.audit.record({
      organizationId: subjectType === 'organization' ? subjectId : null,
      actorUserId: actor.id,
      actorEmail: actor.email,
      action: 'gdpr.deletion_scheduled',
      resourceType: subjectType,
      resourceId: subjectId,
      after: { scheduledFor: scheduledFor.toISOString() },
    });

    await this.mail
      .send({
        to: actor.email,
        template: 'account-deletion-scheduled',
        params: {
          name: actor.name,
          subjectType,
          scheduledFor: scheduledFor.toISOString(),
          privacyUrl: `${this.app.dashboardUrl}/privacy`,
        },
        organizationId: subjectType === 'organization' ? subjectId : null,
        userId: actor.id,
      })
      // The request stands whether or not the confirmation goes out.
      .catch((error: unknown) => {
        this.logger.error(`failed to confirm erasure ${row.id} by email`, String(error));
      });

    return toDto(row);
  }

  /**
   * The insert, with the unique violation translated.
   *
   * The check for an existing request is the database's, not a SELECT before an
   * INSERT: two clicks a second apart would both pass a read and schedule two
   * erasures, and the second would run against a subject that is already gone.
   */
  private async insertOpen(values: {
    subjectType: DeletionSubjectType;
    subjectId: string;
    requestedByUserId: string;
    scheduledFor: Date;
    reason: string | null;
  }): Promise<DeletionRow> {
    try {
      const [row] = await this.db.insert(deletionRequest).values(values).returning();
      if (!row) throw new Error('failed to record the erasure request');
      return row;
    } catch (error: unknown) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(
          'An erasure is already scheduled for this subject',
          ERROR_CODES.GDPR_DELETION_ALREADY_SCHEDULED,
        );
      }
      throw error;
    }
  }

  /** What is open right now for this person and, when they have one, their tenant. */
  async listForCaller(userId: string, organizationId: string | null): Promise<DeletionRequest[]> {
    const subjects = [userId, ...(organizationId ? [organizationId] : [])];

    const rows = await this.db
      .select()
      .from(deletionRequest)
      .where(
        and(
          inArray(deletionRequest.subjectId, subjects),
          inArray(deletionRequest.status, ['scheduled', 'awaiting_billing']),
        ),
      )
      .orderBy(desc(deletionRequest.createdAt));

    return rows.map(toDto);
  }

  /**
   * Changing your mind, which is the whole point of the grace period.
   *
   * Anybody who could have scheduled it can cancel it: for an account that is its
   * owner, for an organization whoever holds `org.delete` — the controller has already
   * checked the permission, this checks the subject is theirs to act on.
   */
  async cancel(userId: string, organizationId: string | null, id: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(deletionRequest)
      .where(eq(deletionRequest.id, id))
      .limit(1);

    if (!row) throw AppException.notFound('Erasure request');

    const mine =
      row.subjectType === 'user'
        ? row.subjectId === userId
        : organizationId !== null && row.subjectId === organizationId;

    // Somebody else's request is indistinguishable from a missing one.
    if (!mine) throw AppException.notFound('Erasure request');

    if (row.status !== 'scheduled' && row.status !== 'awaiting_billing') {
      throw AppException.conflict('That erasure is no longer pending');
    }

    await this.db
      .update(deletionRequest)
      .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
      .where(eq(deletionRequest.id, id));

    await this.audit.record({
      organizationId: row.subjectType === 'organization' ? row.subjectId : null,
      actorUserId: userId,
      action: 'gdpr.deletion_cancelled',
      resourceType: row.subjectType,
      resourceId: row.subjectId,
      before: { scheduledFor: row.scheduledFor.toISOString() },
    });
  }

  // ── Preconditions ──────────────────────────────────────────────────────────

  /**
   * Refuses to schedule an account erasure that would strand somebody else.
   *
   * The organizations this account is alone in go with it — they exist to hold this
   * person's data and nobody else would ever open them again. An organization with
   * other members and no other owner is a different matter: erasing its only owner
   * leaves a tenant nobody can administer, so the answer is "hand it over first".
   */
  private async assertAccountErasable(userId: string): Promise<void> {
    const owned = await this.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.role, 'owner')));

    for (const { organizationId } of owned) {
      const [others] = await this.db
        .select({
          members: count(),
          /**
           * `::int` is not decoration. Postgres returns `count(*)` as a bigint and the
           * pg driver hands bigints back as **strings**, so without the cast this reads
           * `'0'` — and `'0' === 0` is false, which means the refusal below never fires
           * and an owner quietly erases themselves out of a tenant nobody can then
           * administer. Drizzle's own `count()` helper already coerces; a raw `sql`
           * fragment does not. Found by the test that asserts the refusal.
           */
          owners: sql<number>`count(*) filter (where ${member.role} = 'owner')::int`,
        })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), ne(member.userId, userId)));

      if ((others?.members ?? 0) > 0 && Number(others?.owners ?? 0) === 0) {
        throw new AppException(
          ERROR_CODES.ORGANIZATION_LAST_OWNER,
          HttpStatus.CONFLICT,
          'Hand the organization over to another owner before erasing this account',
          { organizationId },
        );
      }
    }

    // Everything that would be erased along with the account, plus the account itself:
    // in `b2c` the subscription hangs off the person, in `b2b` off the tenant, and this
    // covers both without asking which mode is running.
    const solo = await this.soloOrganizations(userId);
    await this.assertNothingBilling([userId, ...solo]);
  }

  private async assertOrganizationErasable(organizationId: string): Promise<void> {
    await this.assertNothingBilling([organizationId]);
  }

  private async assertNothingBilling(references: readonly string[]): Promise<void> {
    const live = await this.liveSubscriptions(references);
    if (live.length === 0) return;

    throw new AppException(
      ERROR_CODES.GDPR_DELETION_BLOCKED_BY_SUBSCRIPTION,
      HttpStatus.CONFLICT,
      'Cancel the subscription before asking for erasure',
      { references: live },
    );
  }

  private async liveSubscriptions(references: readonly string[]): Promise<string[]> {
    if (references.length === 0) return [];

    const rows = await this.db
      .select({ reference: subscription.referenceId })
      .from(subscription)
      .where(
        and(
          inArray(subscription.referenceId, [...references]),
          inArray(subscription.status, [...BILLING_STATUSES]),
        ),
      );

    return [...new Set(rows.map((row) => row.reference))];
  }

  /** The organizations where this account is the only member left. */
  private async soloOrganizations(userId: string): Promise<string[]> {
    const mine = await this.db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(eq(member.userId, userId));

    const solo: string[] = [];
    for (const { organizationId } of mine) {
      const [others] = await this.db
        .select({ value: count() })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), ne(member.userId, userId)));

      if ((others?.value ?? 0) === 0) solo.push(organizationId);
    }
    return solo;
  }

  // ── The worker's half ──────────────────────────────────────────────────────

  /** Enqueues every request that has fallen due. Recurring, from the maintenance queue. */
  async sweepDue(): Promise<number> {
    const due = await this.db
      .select({ id: deletionRequest.id })
      .from(deletionRequest)
      .where(
        and(
          inArray(deletionRequest.status, ['scheduled', 'awaiting_billing']),
          lte(deletionRequest.scheduledFor, new Date()),
        ),
      );

    for (const row of due) {
      // Keyed by request id: a sweep that runs while the previous one is still working
      // must not enqueue the same erasure twice.
      await this.queue.add(JOBS.GDPR_DELETE, { requestId: row.id }, { jobId: `erasure-${row.id}` });
    }

    return due.length;
  }

  /** Carries out one erasure. Called from the queue, never from a handler. */
  async execute(requestId: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(deletionRequest)
      .where(eq(deletionRequest.id, requestId))
      .limit(1);

    if (!row) {
      this.logger.warn(`erasure ${requestId} no longer exists`);
      return;
    }
    if (row.status !== 'scheduled' && row.status !== 'awaiting_billing') {
      // Cancelled between falling due and being picked up. That is the grace period
      // working, not an error.
      this.logger.log(`erasure ${requestId} is ${row.status} — skipping`);
      return;
    }

    try {
      const erased =
        row.subjectType === 'user'
          ? await this.eraseAccount(row.subjectId)
          : await this.eraseOrganization(row.subjectId);

      if (!erased) {
        await this.db
          .update(deletionRequest)
          .set({
            status: 'awaiting_billing',
            error: 'a live subscription still references this subject',
            updatedAt: new Date(),
          })
          .where(eq(deletionRequest.id, requestId));
        this.logger.warn(`erasure ${requestId} is waiting: the subject still has a subscription`);
        return;
      }

      await this.db
        .update(deletionRequest)
        .set({ status: 'executed', executedAt: new Date(), error: null, updatedAt: new Date() })
        .where(eq(deletionRequest.id, requestId));

      await this.audit.record({
        // The tenant is gone; a reference to it would be deleted along with it.
        organizationId: null,
        // The actor is gone too, which is the point. The subject id is the record.
        actorUserId: null,
        action: 'gdpr.deletion_executed',
        resourceType: row.subjectType,
        resourceId: row.subjectId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await this.db
        .update(deletionRequest)
        .set({ status: 'failed', error: message.slice(0, 500), updatedAt: new Date() })
        .where(eq(deletionRequest.id, requestId));
      throw error;
    }
  }

  /** Returns false when money still points at the subject and it must wait. */
  private async eraseAccount(userId: string): Promise<boolean> {
    const solo = await this.soloOrganizations(userId);
    if ((await this.liveSubscriptions([userId, ...solo])).length > 0) return false;

    // Read before the rows go: once the organization is deleted its files are gone
    // from the database and their objects would be unreachable rubbish in the bucket.
    const objectKeys = [
      ...(await this.objectKeysOfOrganizations(solo)),
      ...(await this.exports.objectKeysFor({ userId })),
    ];

    await this.db.transaction(async (tx) => {
      // Operational records of mail sent to this person. Nothing needs them once the
      // person is gone, and `to_email` is their address in clear.
      await tx.delete(emailMessage).where(eq(emailMessage.userId, userId));

      /**
       * The trail stays; the person does not. `actor_user_id` becomes null by foreign
       * key when the row below is deleted, but `actor_email` is a snapshot column and
       * would survive with the address in it.
       */
      await tx.update(auditLog).set({ actorEmail: null }).where(eq(auditLog.actorUserId, userId));

      if (solo.length > 0) {
        await tx.delete(organization).where(inArray(organization.id, solo));
      }

      // Cascades through session, account, two_factor, member, notification,
      // notification_preference, invitation and gdpr_export_request.
      await tx.delete(user).where(eq(user.id, userId));
    });

    await this.s3.deleteMany(objectKeys);
    return true;
  }

  private async eraseOrganization(organizationId: string): Promise<boolean> {
    if ((await this.liveSubscriptions([organizationId])).length > 0) return false;

    const objectKeys = [
      ...(await this.objectKeysOfOrganizations([organizationId])),
      ...(await this.exports.objectKeysFor({ organizationId })),
    ];

    // Cascades through member, invitation, project, file, notification, audit_log,
    // email_message, feature_flag_override and gdpr_export_request.
    await this.db.delete(organization).where(eq(organization.id, organizationId));

    await this.s3.deleteMany(objectKeys);
    return true;
  }

  private async objectKeysOfOrganizations(organizationIds: readonly string[]): Promise<string[]> {
    if (organizationIds.length === 0) return [];

    const rows = await this.db
      .select({ objectKey: file.objectKey })
      .from(file)
      .where(inArray(file.organizationId, [...organizationIds]));

    return rows.map((row) => row.objectKey);
  }
}

/**
 * Whether this is the partial unique index refusing a second open request.
 *
 * The cause chain is walked rather than the top-level `code` read, because Drizzle
 * wraps driver errors: the pg error with its SQLSTATE on it ends up as `cause`, and a
 * check on the wrapper alone silently never matches — which turns a 409 that says
 * exactly what happened into a 500 that says nothing. It did, until a test asked.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;

  for (let depth = 0; current && depth < 5; depth += 1) {
    if ((current as { code?: string }).code === UNIQUE_VIOLATION) return true;
    current = (current as { cause?: unknown }).cause;
  }

  return false;
}

function toDto(row: DeletionRow): DeletionRequest {
  return {
    id: row.id,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    status: row.status,
    scheduledFor: row.scheduledFor.toISOString(),
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  };
}
