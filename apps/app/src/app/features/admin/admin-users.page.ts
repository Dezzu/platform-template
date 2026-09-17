import { Component, computed, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import {
  lucideBan,
  lucideCircleCheck,
  lucideCircleX,
  lucideKeyRound,
  lucideLogOut,
  lucideMailCheck,
  lucideShield,
  lucideUsers,
} from '@ng-icons/lucide';
import {
  ORG_ROLES,
  PLATFORM_ROLES,
  platformOutranksOrEquals,
  type OrgRole,
  type PlatformRole,
} from '@app/contracts/permissions';
import type { AdminUser } from '@app/contracts';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableAction, TableColumn } from '@app/ui/mix';
import { AuthService, PermissionsService, ToastService } from '@app/core';
import { AdminApi } from './admin.api';

/** What the table last asked the server for. */
interface Query {
  page: number;
  size: number;
  q: string;
  sort: string | undefined;
  dir: 'asc' | 'desc';
}

const NO_ORGANIZATION = '';

/**
 * Every account on the platform.
 *
 * The row actions live behind the three dots rather than in a row of icons: there are
 * up to six of them and several are destructive, and a line of symbols makes you hover
 * each one to find out what it does. A menu says it in words.
 *
 * The list is lazy — the table announces page, sort and search, and the server answers.
 * Filtering client-side over one loaded page would quietly mean "search the 50 accounts
 * you happen to be looking at", which on this screen is the wrong answer rather than a
 * slow one.
 *
 * Every action mirrors the server's rank rules through `visible`. That matters more here
 * than anywhere else in the application: elsewhere a wrongly-shown button is a 403, here
 * it is a support person believing they did something they did not.
 */
@Component({
  selector: 'app-admin-users-page',
  imports: [TranslocoPipe, RouterLink, NgIcon, TableComponent, TemplateDirective],
  providers: [
    provideIcons({
      lucideShield,
      lucideUsers,
      lucideKeyRound,
      lucideMailCheck,
      lucideLogOut,
      lucideBan,
      lucideCircleCheck,
      lucideCircleX,
    }),
  ],
  templateUrl: './admin-users.page.html',
})
export class AdminUsersPage {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly permissions = inject(PermissionsService);
  private readonly toasts = inject(ToastService);

  /**
   * Re-translates the action labels when the translations change under them.
   *
   * `langChanges$` alone is not enough, and the difference is visible: translations
   * load asynchronously, so on a cold page a `translate()` call inside a computed runs
   * before the file has arrived, returns the key, and caches it. The labels would read
   * `admin.sendReset` until the user switched language. `events$` covers the load;
   * merging both covers the switch too.
   */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  /**
   * The organization the list is narrowed to, from the URL rather than from component
   * state: arriving here from the organizations screen is a navigation, so the filter
   * has to survive a reload and a copied link like any other part of the address.
   */
  protected readonly organizationId = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(
      map((params) => params.get('organizationId') ?? NO_ORGANIZATION),
    ),
    { initialValue: NO_ORGANIZATION },
  );

  /** Only to name the filter on screen; the filtering itself is the id above. */
  private readonly organization = resource({
    params: () => this.organizationId(),
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.getOrganization(params)) : Promise.resolve(null),
  });

  protected readonly organizationName = computed(() =>
    this.organization.hasValue() ? (this.organization.value()?.name ?? '') : '',
  );

  /**
   * Custom equality, and it is load-bearing: `onLazyLoad` fires once on init with the
   * table's starting state, which matches the defaults below. Without this the `set`
   * would still produce a new object identity, the resource would see a changed
   * parameter, and every page load would fetch the same page twice.
   */
  protected readonly query = signal<Query>(
    // These must be exactly what `onLazyLoad` produces on init, or the equality below
    // cannot recognise the table's opening announcement as "no change".
    { page: 0, size: 10, q: '', sort: undefined, dir: 'asc' },
    {
      equal: (a, b) =>
        a.page === b.page &&
        a.size === b.size &&
        a.q === b.q &&
        a.sort === b.sort &&
        a.dir === b.dir,
    },
  );

  private readonly page = resource({
    params: () => ({ ...this.query(), organizationId: this.organizationId() }),
    loader: ({ params }) =>
      firstValueFrom(
        this.api.listUsers({
          page: params.page,
          size: params.size,
          dir: params.dir,
          ...(params.q ? { q: params.q } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
          ...(params.organizationId ? { organizationId: params.organizationId } : {}),
        }),
      ),
  });

  /** Drops the organization filter by leaving the URL, not by mutating a signal. */
  protected clearOrganization(): void {
    void this.router.navigate(['/admin/users'], { queryParams: {} });
  }

  /**
   * `hasValue()` rather than `value() ?? …`: a resource in an error state THROWS from
   * `value()`, so reading it optimistically takes the whole render down with it — and
   * the first casualty is the error message that was supposed to explain what happened.
   */
  protected readonly rows = computed(() => (this.page.hasValue() ? this.page.value().items : []));
  protected readonly total = computed(() =>
    this.page.hasValue() ? this.page.value().meta.total : 0,
  );
  /**
   * Skeletons only when there is nothing to show yet.
   *
   * `isLoading()` is also true while reloading after a mutation, and binding it
   * directly replaced the rows with skeletons every time somebody changed a role —
   * which reads as the whole page reloading for a change to one cell. Reloading keeps
   * the previous value, so the table can simply keep showing it until the new one
   * lands. Changing page or search does clear it, and there the skeleton is correct.
   */
  protected readonly loading = computed(() => this.page.isLoading() && !this.page.hasValue());
  protected readonly failed = computed(() => this.page.error() !== undefined);

  private readonly myRole = computed(() => this.auth.user()?.role ?? 'user');
  private readonly mayManage = computed(() =>
    this.permissions.anyOfPlatform('platform.users.manage'),
  );
  private readonly mayManageOrganizations = computed(() =>
    this.permissions.anyOfPlatform('platform.organizations.manage'),
  );

  /**
   * One column set, always the same.
   *
   * An earlier version swapped a column in and out depending on whether the list was
   * scoped to an organization. It made the screen two screens: the same route looked
   * different depending on how you had reached it, and every future change had to be
   * thought through twice. The role column now simply reads "—" when there is no
   * organization to have a role in, and anyone who does not want it can drop it from
   * the column selector.
   */
  protected readonly columns = computed<TableColumn[]>(() => {
    const t = (key: string) => this.translate(`admin.columns.${key}`);
    return [
      { field: 'name', header: t('name'), sortable: true },
      { field: 'email', header: t('email'), sortable: true },
      { field: 'role', header: t('role'), sortable: false },
      { field: 'organizationCount', header: t('organizations'), sortable: false, removable: true },
      {
        field: 'organizationRole',
        header: t('organizationRole'),
        sortable: false,
        removable: true,
      },
      {
        field: 'createdAt',
        header: t('createdAt'),
        sortable: true,
        pipe: 'date',
        pipeArgs: ['mediumDate'],
        removable: true,
        defaultRemoved: true,
      },
    ];
  });

  /**
   * One entry per role instead of a select, because a menu holds buttons.
   *
   * Only the roles this viewer may grant, and never the one the account already has —
   * an entry that would be a no-op is an entry that makes the menu longer for nothing.
   */
  protected readonly actions = computed<TableAction<AdminUser>[]>(() => {
    const grantable = PLATFORM_ROLES.filter((role) =>
      platformOutranksOrEquals(this.myRole(), role),
    );

    /**
     * Under a heading the entry can just be the role: "Amministratore" below "Ruolo di
     * piattaforma" says what "Rendi amministratore di piattaforma" said, and the menu
     * reads as a list of choices instead of a list of sentences.
     */
    const roleActions: TableAction<AdminUser>[] = grantable.map((role) => ({
      icon: 'lucideShield',
      group: this.translate('admin.groups.platform'),
      label: this.translate(`admin.roles.${role}`),
      visible: (row) => this.canChangeRoleOf(row) && (row.role ?? 'user') !== role,
      command: (row) => this.setRole(row, role),
    }));

    /**
     * Only while the list is scoped to one organization: outside that scope there is no
     * single membership to change, and offering the entry anyway would raise the
     * question "in which organization?" that the screen cannot answer.
     */
    const organizationId = this.organizationId();
    const organizationActions: TableAction<AdminUser>[] = organizationId
      ? ORG_ROLES.map((role) => ({
          icon: 'lucideUsers',
          group: this.translate('admin.groups.organization'),
          label: this.translate(`members.roles.${role}`),
          visible: (row: AdminUser) =>
            this.mayManageOrganizations() &&
            row.organizationRole !== null &&
            row.organizationRole !== role,
          command: (row: AdminUser) => this.setOrganizationRole(organizationId, row, role),
        }))
      : [];

    return [
      ...roleActions,
      ...organizationActions,
      {
        icon: 'lucideMailCheck',
        group: this.translate('admin.groups.account'),
        label: this.translate('admin.sendVerification'),
        // The common support case: they signed up, it went to spam, they cannot get in.
        visible: (row) => this.canActOn(row) && !row.emailVerified,
        command: (row) => this.sendVerificationEmail(row),
      },
      {
        icon: 'lucideKeyRound',
        group: this.translate('admin.groups.account'),
        label: this.translate('admin.sendReset'),
        visible: (row) => this.canActOn(row),
        command: (row) => this.sendPasswordReset(row),
      },
      {
        icon: 'lucideLogOut',
        // Destructive: it throws the person out of every device they are signed in on,
        // and nothing undoes it. The table draws a line above the first of these.
        severity: 'destructive',
        label: this.translate('admin.revokeSessions'),
        visible: (row) => this.canActOn(row),
        command: (row) => this.revokeSessions(row),
      },
      {
        icon: 'lucideBan',
        severity: 'destructive',
        label: this.translate('admin.ban'),
        visible: (row) => this.canActOn(row) && !this.isSelf(row) && !row.banned,
        command: (row) => this.ban(row),
      },
      {
        icon: 'lucideCircleCheck',
        severity: 'destructive',
        label: this.translate('admin.unban'),
        visible: (row) => this.canActOn(row) && row.banned,
        command: (row) => this.unban(row),
      },
    ];
  });

  /**
   * Narrows the row a projected template receives.
   *
   * `duiTemplate` hands over `unknown` — it is matched by name at runtime and cannot
   * know what the table holds. One cast here, at the top of each template, beats
   * scattering `$any()` through the markup.
   */
  protected asUser(value: unknown): AdminUser {
    return value as AdminUser;
  }

  protected isSelf(account: AdminUser): boolean {
    return account.id === this.auth.user()?.id;
  }

  /** Mirrors `assertMayActOn`: never offer an action the API is going to refuse. */
  protected canActOn(account: AdminUser): boolean {
    return this.mayManage() && platformOutranksOrEquals(this.myRole(), account.role ?? 'user');
  }

  /** Changing your own platform role is refused server-side — see the lockout note. */
  protected canChangeRoleOf(account: AdminUser): boolean {
    return this.canActOn(account) && !this.isSelf(account);
  }

  protected roleLabel(account: AdminUser): string {
    return this.translate(`admin.roles.${account.role ?? 'user'}`);
  }

  /** The table announces what it wants; the server decides what it gets. */
  protected onLazyLoad(event: DuiTablelazyLoadEvent): void {
    /**
     * An explicit reload asks for the same parameters again, and the equality below is
     * built precisely to ignore that — so it has to be handled before the comparison
     * rather than through it, or the button does nothing.
     */
    if (event.reload) {
      this.page.reload();
      return;
    }

    const request = event.pageRequest;
    const sort = typeof request.sortField === 'string' ? request.sortField : undefined;
    const search = typeof request.query === 'string' ? request.query : '';

    this.query.set({
      page: request.page,
      size: request.size,
      q: search,
      sort,
      dir: request.sortOrder === -1 ? 'desc' : 'asc',
    });
  }

  private setRole(account: AdminUser, role: PlatformRole): void {
    void this.run(async () => {
      await firstValueFrom(this.api.setRole(account.id, role));
      this.page.reload();
    });
  }

  private sendPasswordReset(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.sendPasswordReset(account.id));
      // No reload: nothing about the account changed, an email was queued.
      this.toasts.success('admin.resetLinkQueued');
    });
  }

  private ban(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.ban(account.id, { reason: 'Banned from the admin area' }));
      this.page.reload();
    });
  }

  private unban(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.unban(account.id));
      this.page.reload();
    });
  }

  private sendVerificationEmail(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.sendVerificationEmail(account.id));
      this.toasts.success('admin.verificationQueued', { email: account.email });
    });
  }

  private setOrganizationRole(organizationId: string, account: AdminUser, role: OrgRole): void {
    void this.run(async () => {
      await firstValueFrom(this.api.setOrganizationRole(organizationId, account.id, role));
      this.page.reload();
    });
  }

  private revokeSessions(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.revokeSessions(account.id));
      this.toasts.success('admin.sessionsRevoked');
    });
  }

  private translate(key: string, params?: Record<string, unknown>): string {
    // Reading the signal is what makes the calling computed re-run when the
    // translations load, or when the language changes.
    this.translations();
    return this.transloco.translate(key, params);
  }

  /**
   * One place to report a refusal, since every action here can be refused. A toast
   * rather than a line at the top of the page: the outcome belongs to the click, and
   * on a list that scrolls the top of the page is often not where the click was.
   */
  private async run(action: () => Promise<void>): Promise<void> {
    try {
      await action();
    } catch (error: unknown) {
      this.toasts.error(error);
    }
  }
}
