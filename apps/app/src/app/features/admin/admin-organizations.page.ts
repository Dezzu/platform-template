import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import type { AdminOrganization, AdminOrganizationDetail } from '@app/contracts';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableColumn } from '@app/ui/mix';
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
 * Read-only, deliberately — hence no actions column and no three dots. Deleting a
 * tenant from a support list is one mis-click away from deleting a customer, and the
 * operations that actually come up in support (change a role, get someone back in)
 * belong to the members screen.
 *
 * Expanding a row fetches that organization's members, so "who is in there?" is one
 * click rather than a page. It is fetched on expand and not up front: loading the
 * members of every organization on the page so that opening one feels instant is the
 * alternative, and it is the wrong one on a list of any size.
 */
@Component({
  selector: 'app-admin-organizations-page',
  imports: [TranslocoPipe, RouterLink, TableComponent, TemplateDirective],
  templateUrl: './admin-organizations.page.html',
})
export class AdminOrganizationsPage {
  private readonly api = inject(AdminApi);
  private readonly transloco = inject(TranslocoService);

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
  protected readonly loading = computed(() => this.page.isLoading());
  protected readonly failed = computed(() => this.page.error() !== undefined);

  /** The row whose members are on screen. Only ever one. */
  private readonly expandedId = signal<string | null>(null);

  private readonly detail = resource({
    params: () => this.expandedId(),
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.getOrganization(params)) : Promise.resolve(null),
  });

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

  protected asOrganization(value: unknown): AdminOrganization {
    return value as AdminOrganization;
  }

  /** The members currently loaded, but only for the row that is actually open. */
  protected membersOf(organization: AdminOrganization): AdminOrganizationDetail | null {
    if (!this.detail.hasValue()) return null;
    const loaded = this.detail.value();
    return loaded?.id === organization.id ? loaded : null;
  }

  protected readonly detailLoading = computed(() => this.detail.isLoading());

  protected onExpand(event: { row: AdminOrganization; expanded: boolean }): void {
    this.expandedId.set(event.expanded ? event.row.id : null);
  }

  protected onLazyLoad(event: DuiTablelazyLoadEvent): void {
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
