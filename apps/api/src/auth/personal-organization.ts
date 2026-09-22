import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { createsOrganizationOnSignUp } from '@app/contracts';
import { member, organization } from '@app/db';
import { eq } from 'drizzle-orm';
import { appMode } from '../config/app-mode';
import { db } from '../database/db';

const logger = new Logger('PersonalOrganization');

/**
 * Gives a brand-new account the organization its data will live in.
 *
 * Every domain table is scoped to an organization — that is the isolation boundary,
 * not a feature of the B2B plan — so an account without one cannot read or write
 * anything: `PermissionsGuard` answers ORGANIZATION_REQUIRED on every tenant-scoped
 * route. In `b2b` the user is asked to create one, which is a screen. In `b2c` asking
 * would be asking about plumbing, so it happens here and is never mentioned.
 *
 * Written with Drizzle rather than through `auth.api.createOrganization`: that endpoint
 * resolves the caller from a session, and at this point in a signup there is no session
 * yet. The rows are the same ones it would write.
 *
 * Deliberately idempotent. A database hook can run again — a retried signup, a social
 * login that links to an existing account — and a second organization for the same
 * person would silently split their data in two.
 */
export async function ensurePersonalOrganization(user: {
  id: string;
  name?: string | null;
  email: string;
}): Promise<void> {
  if (!createsOrganizationOnSignUp(appMode())) return;

  try {
    const [existing] = await db
      .select({ id: member.id })
      .from(member)
      .where(eq(member.userId, user.id))
      .limit(1);

    if (existing) return;

    const organizationId = randomUUID();
    const now = new Date();

    await db.insert(organization).values({
      id: organizationId,
      // Never shown in this mode, but it has to read sensibly anywhere an
      // administrator looks — the platform organizations list, an audit entry.
      name: user.name?.trim() || user.email,
      // The slug is unique and the id already is, so deriving it needs no retry loop.
      slug: `u-${organizationId}`,
      createdAt: now,
    });

    await db.insert(member).values({
      id: randomUUID(),
      organizationId,
      userId: user.id,
      // Owner of their own space: in this mode nobody else is ever in it, and a lower
      // role would mean an account that cannot manage what it alone owns.
      role: 'owner',
      createdAt: now,
    });
  } catch (error: unknown) {
    // Signing up must not fail because of this. The account exists and can sign in;
    // what it cannot do yet is reach any data, which is visible and recoverable —
    // whereas a signup that 500s after the user row was written is neither.
    logger.error(
      `could not create the personal organization for ${user.id}`,
      error instanceof Error ? error.stack : String(error),
    );
  }
}
