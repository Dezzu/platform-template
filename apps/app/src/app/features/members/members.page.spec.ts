import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member, OrgRole } from '@app/contracts';
import type { TableAction } from '@app/ui/mix';
import { AppError, AuthService, PermissionsService, ToastService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { MembersApi } from './members.api';
import { MembersPage } from './members.page';

const makeMember = (over: Partial<Member> & { id: string; role: OrgRole }): Member => ({
  organizationId: 'o',
  createdAt: '2026-01-01T00:00:00.000Z',
  user: {
    id: `u-${over.id}`,
    name: `User ${over.id}`,
    email: `${over.id}@test.local`,
    image: null,
  },
  ...over,
});

const OWNER = makeMember({ id: 'owner', role: 'owner' });
const ADMIN = makeMember({ id: 'admin', role: 'admin' });
const PLAIN = makeMember({ id: 'plain', role: 'member' });

const listOf = (items: Member[]) =>
  of({
    items,
    meta: { page: 0, size: 100, total: items.length, totalPages: 1 },
  });

/**
 * `viewerRole` is what these cases turn on: the screen has to mirror the server's rank
 * rule, or it offers buttons that always answer 403.
 */
function setup(
  api: Partial<MembersApi>,
  options: { permissions?: string[]; viewerRole?: OrgRole; viewerId?: string } = {},
) {
  const permissions = options.permissions ?? [
    'members.read',
    'members.invite',
    'members.manage',
    'members.remove',
  ];

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideI18n('it'),
      provideCore({
        apiUrl: '/api',
        authUrl: '/api/auth',
        loginRoute: '/sign-in',
        homeRoute: '/dashboard',
        defaultLocale: 'it',
        supportedLocales: ['it', 'en'],
      }),
      { provide: MembersApi, useValue: { listInvitations: () => of([]), ...api } },
      ToastService,
      {
        provide: AuthService,
        useValue: { user: () => ({ id: options.viewerId ?? 'u-owner' }) },
      },
      {
        provide: PermissionsService,
        useValue: {
          role: () => options.viewerRole ?? 'owner',
          anyOf: (...required: string[]) => required.some((p) => permissions.includes(p)),
          allOf: (...required: string[]) => required.every((p) => permissions.includes(p)),
        },
      },
    ],
  });
  return TestBed.createComponent(MembersPage);
}

const page = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;

/**
 * The row actions live behind the three dots, and the menu only exists once opened —
 * a CDK overlay, not markup on the page. These cases therefore read the component's
 * own action list and run each `visible` predicate, which is where the server's rank
 * rules are mirrored.
 */
const internalsOf = (fixture: { componentInstance: unknown }) =>
  fixture.componentInstance as unknown as { memberActions: () => TableAction<Member>[] };

const offered = (fixture: { componentInstance: unknown }, row: Member): string[] =>
  internalsOf(fixture)
    .memberActions()
    .filter((action) => action.visible?.(row, []) ?? true)
    .map((action) => (typeof action.label === 'function' ? action.label(row, []) : action.label))
    .filter((label): label is string => label !== undefined);

const rowFor = (fixture: { nativeElement: unknown }, email: string) =>
  [...page(fixture).querySelectorAll('tbody tr')].find((row) => row.textContent?.includes(email));

describe('MembersPage', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lists the members with their email', async () => {
    const fixture = setup({ list: () => listOf([OWNER, PLAIN]) });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('owner@test.local');
    expect(page(fixture).textContent).toContain('plain@test.local');
  });

  it('marks which row is you', async () => {
    const fixture = setup({ list: () => listOf([OWNER, PLAIN]) }, { viewerId: 'u-plain' });
    await fixture.whenStable();

    expect(page(fixture).textContent).toContain('(tu)');
  });

  it('offers an admin nothing at all on the owner', async () => {
    const fixture = setup(
      { list: () => listOf([OWNER, ADMIN, PLAIN]) },
      { viewerRole: 'admin', viewerId: 'u-admin' },
    );
    await fixture.whenStable();

    // The server refuses either way; offering the control means a 403 per click.
    expect(offered(fixture, OWNER)).toEqual([]);
    expect(offered(fixture, PLAIN).length).toBeGreaterThan(0);

    // And with nothing to offer, the three dots do not appear on that row either.
    expect(rowFor(fixture, 'owner@test.local')?.querySelector('button')).toBeNull();
    expect(rowFor(fixture, 'plain@test.local')?.querySelector('button')).not.toBeNull();
  });

  it('offers an admin only the roles an admin may grant', async () => {
    const fixture = setup(
      { list: () => listOf([PLAIN]) },
      { viewerRole: 'admin', viewerId: 'u-admin' },
    );
    await fixture.whenStable();

    // Under the "Ruolo" heading the entry is just the role, which is why the heading
    // is there at all.
    const labels = offered(fixture, PLAIN);
    expect(labels).toContain('Amministratore');
    expect(labels).not.toContain('Owner');
    // The role they already hold is not offered.
    expect(labels).not.toContain('Membro');
  });

  it('hides the invite form from someone who may only read', async () => {
    const fixture = setup({ list: () => listOf([PLAIN]) }, { permissions: ['members.read'] });
    await fixture.whenStable();

    expect(page(fixture).querySelector('form')).toBeNull();
  });

  it('translates a refusal from the API', async () => {
    const fixture = setup({
      list: () => listOf([OWNER, PLAIN]),
      updateRole: () => throwError(() => new AppError(403, 'CANNOT_GRANT_HIGHER_ROLE', 'nope')),
    });
    await fixture.whenStable();

    const promote = internalsOf(fixture)
      .memberActions()
      .find((action) => action.label === 'Amministratore');
    promote?.command(PLAIN, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    // The outcome of an action is a toast, raised into the service the root renders.
    expect(
      TestBed.inject(ToastService)
        .toasts()
        .map((toast) => toast.messageKey),
    ).toEqual(['errors.CANNOT_GRANT_HIGHER_ROLE']);
  });

  it('reloads the list after a role change', async () => {
    const list = vi.fn(() => listOf([OWNER, PLAIN]));
    const fixture = setup({ list, updateRole: () => of({ ...PLAIN, role: 'admin' as OrgRole }) });
    await fixture.whenStable();
    expect(list).toHaveBeenCalledTimes(1);

    const promote = internalsOf(fixture)
      .memberActions()
      .find((action) => action.label === 'Amministratore');
    promote?.command(PLAIN, []);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();

    expect(list).toHaveBeenCalledTimes(2);
  });
});
