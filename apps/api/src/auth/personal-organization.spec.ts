import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { member, organization, user } from '@app/db';
import { db } from '../database/db';
import { ensurePersonalOrganization } from './personal-organization';

/**
 * The hook that decides whether a brand-new account can use the product at all.
 *
 * Every domain table is scoped to an organization, so an account without one gets
 * ORGANIZATION_REQUIRED on every tenant-scoped route. In `b2c` nobody is going to be
 * asked for the organization's name, so it has to appear on its own.
 */
describe('ensurePersonalOrganization', () => {
  const created: string[] = [];
  let previousMode: string | undefined;

  const makeUser = async (label: string) => {
    const id = `po-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await db.insert(user).values({
      id,
      name: `User ${label}`,
      email: `${id}@test.local`,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    created.push(id);
    return { id, name: `User ${label}`, email: `${id}@test.local` };
  };

  const membershipsOf = (userId: string) =>
    db.select().from(member).where(eq(member.userId, userId));

  beforeEach(() => {
    previousMode = process.env['APP_MODE'];
  });

  afterEach(async () => {
    if (previousMode === undefined) delete process.env['APP_MODE'];
    else process.env['APP_MODE'] = previousMode;

    for (const id of created.splice(0)) {
      const rows = await membershipsOf(id);
      await db.delete(member).where(eq(member.userId, id));
      for (const row of rows) {
        await db.delete(organization).where(eq(organization.id, row.organizationId));
      }
      await db.delete(user).where(eq(user.id, id));
    }
  });

  it('gives a b2c account the organization its data will live in', async () => {
    process.env['APP_MODE'] = 'b2c';
    const account = await makeUser('b2c');

    await ensurePersonalOrganization(account);

    const memberships = await membershipsOf(account.id);
    expect(memberships).toHaveLength(1);
    // Owner of their own space: nobody else is ever in it, and a lower role would be
    // an account that cannot manage what it alone owns.
    expect(memberships[0]?.role).toBe('owner');
  });

  it('leaves a b2b account without one, because it will be asked', async () => {
    process.env['APP_MODE'] = 'b2b';
    const account = await makeUser('b2b');

    await ensurePersonalOrganization(account);

    expect(await membershipsOf(account.id)).toHaveLength(0);
  });

  it('does not create a second one when it runs again', async () => {
    process.env['APP_MODE'] = 'b2c';
    const account = await makeUser('twice');

    await ensurePersonalOrganization(account);
    await ensurePersonalOrganization(account);

    // A database hook can run twice — a retried signup, a social login linking to an
    // existing account — and a second organization would split the person's data.
    expect(await membershipsOf(account.id)).toHaveLength(1);
  });

  it('names the organization after the person, for whoever looks at it later', async () => {
    process.env['APP_MODE'] = 'b2c';
    const account = await makeUser('named');

    await ensurePersonalOrganization(account);

    const [membership] = await membershipsOf(account.id);
    const [row] = await db
      .select()
      .from(organization)
      .where(eq(organization.id, membership?.organizationId ?? ''));

    // Never shown in this mode, but an administrator sees it in the platform list.
    expect(row?.name).toBe(account.name);
  });

  it('leaves alone somebody who already belongs somewhere', async () => {
    process.env['APP_MODE'] = 'b2c';
    const account = await makeUser('invited');

    const organizationId = `org-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await db
      .insert(organization)
      .values({ id: organizationId, name: 'Acme', slug: organizationId, createdAt: new Date() });
    await db.insert(member).values({
      id: `m-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      organizationId,
      userId: account.id,
      role: 'member',
      createdAt: new Date(),
    });

    await ensurePersonalOrganization(account);

    const memberships = await membershipsOf(account.id);
    expect(memberships).toHaveLength(1);
    // Somebody who arrived through an invitation must not also get a space of their own.
    expect(memberships[0]?.role).toBe('member');
  });

  it('does not fail the signup when the insert is refused', async () => {
    process.env['APP_MODE'] = 'b2c';
    const account = await makeUser('broken');
    const insert = vi.spyOn(db, 'insert').mockImplementation(() => {
      throw new Error('constraint violation');
    });

    // The account exists and can sign in; what it cannot do is reach any data, which
    // is visible and recoverable. A signup that 500s after the user row was written
    // is neither.
    await expect(ensurePersonalOrganization(account)).resolves.toBeUndefined();

    insert.mockRestore();
    expect(await membershipsOf(account.id)).toHaveLength(0);
  });
});
