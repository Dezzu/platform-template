import { Component, computed, inject, resource, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { provideIcons } from '@ng-icons/core';
import { lucideUsers } from '@ng-icons/lucide';
import type { AdminOrganization } from '@app/contracts';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableAction, TableColumn } from '@app/ui/mix';
import { PermissionsService } from '@app/core';
import { AdminApi } from './admin.api';

/** What the table last asked the server for. */
interface Query {
  page: number;
  size: number;
  q: string;
  sort: string | undefined;
  dir: 'asc' | 'desc';
}

/**
 * Every organization on the platform.
 *
 * The row action leads to the accounts of that organization rather than showing them
 * here. Two reasons: the useful thing to do with a member is to act on them, and every
 * one of those actions already exists on the users screen — a second, lesser copy of it
 * inside an expanded row would be a place for the two to disagree.
 *
 * The organization itself stays read-only. Deleting a tenant from a support list is one
 * mis-click away from deleting a customer.
 */
@Component({
  selector: 'app-admin-organizations-page',
  imports: [TranslocoPipe, RouterLink, TableComponent, TemplateDirective],
  providers: [provideIcons({ lucideUsers })],
  templateUrl: './admin-organizations.page.html',
})
export class AdminOrganizationsPage {
  private readonly api = inject(AdminApi);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);
  private readonly permissions = inject(PermissionsService);

  /** See the note in admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  protected readonly query = signal<Query>(
    // Exactly what `onLazyLoad` produces on init, so the table's opening announcement
    // is recognised as "no change" instead of triggering a second identical fetch.
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
    params: () => this.query(),
    loader: ({ params }) =>
      firstValueFrom(
        this.api.listOrganizations({
          page: params.page,
          size: params.size,
          dir: params.dir,
          ...(params.q ? { q: params.q } : {}),
          ...(params.sort ? { sort: params.sort } : {}),
        }),
      ),
  });

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

  protected readonly columns = computed<TableColumn[]>(() => {
    this.translations();
    const t = (key: string) => this.transloco.translate(`admin.columns.${key}`);
    return [
      { field: 'name', header: t('organization'), sortable: true },
      { field: 'memberCount', header: t('members'), sortable: false },
      { field: 'subscription', header: t('plan'), sortable: false },
      {
        field: 'createdAt',
        header: t('createdAt'),
        sortable: true,
        pipe: 'date',
        pipeArgs: ['mediumDate'],
      },
    ];
  });

  protected readonly actions = computed<TableAction<AdminOrganization>[]>(() => {
    this.translations();
    return [
      {
        icon: 'lucideUsers',
        label: this.transloco.translate('admin.manageMembers'),
        // Pointless for whoever cannot open the users screen anyway.
        visible: () => this.permissions.anyOfPlatform('platform.users.read'),
        command: (row) => this.openMembers(row),
      },
    ];
  });

  protected asOrganization(value: unknown): AdminOrganization {
    return value as AdminOrganization;
  }

  /** The accounts of this organization, on the screen that can act on them. */
  private openMembers(organization: AdminOrganization): void {
    void this.router.navigate(['/admin/users'], {
      queryParams: { organizationId: organization.id },
    });
  }

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
}
