import { Component, computed, inject, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { provideIcons } from '@ng-icons/core';
import { lucideTrash2 } from '@ng-icons/lucide';
import { PERMISSIONS } from '@app/contracts/permissions';
import type { Project } from '@app/contracts';
import { TableComponent } from '@app/ui/table';
import { TemplateDirective } from '@app/ui/mix';
import type { DuiTablelazyLoadEvent, TableAction, TableColumn } from '@app/ui/mix';
import { PermissionsService, ToastService } from '@app/core';
import { ProjectsApi } from './projects.api';

/** What the table last asked the server for. */
interface Query {
  page: number;
  size: number;
  q: string;
  sort: string | undefined;
  dir: 'asc' | 'desc';
}

/**
 * The reference feature screen — copy this shape when adding a real one.
 *
 * It is a `dui-table` driven lazily: the table announces page, sort and search, and
 * the server answers. Sorting and filtering in the browser over one loaded page would
 * silently mean "search the rows you happen to be looking at", which is the wrong
 * answer rather than a slow one on anything that grows.
 *
 * Row actions live behind the three dots and are filtered by permission through
 * `visible`. That is a courtesy, not a control: the API re-checks every call, which is
 * why a refusal still has to be reported.
 */
@Component({
  selector: 'app-projects-page',
  imports: [TranslocoPipe, TableComponent, TemplateDirective],
  providers: [provideIcons({ lucideTrash2 })],
  templateUrl: './projects.page.html',
})
export class ProjectsPage {
  private readonly api = inject(ProjectsApi);
  private readonly permissions = inject(PermissionsService);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
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
        this.api.list({
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
   * the first casualty is the message that was supposed to explain what happened.
   */
  protected readonly rows = computed(() => (this.page.hasValue() ? this.page.value().items : []));
  protected readonly total = computed(() =>
    this.page.hasValue() ? this.page.value().meta.total : 0,
  );
  /** Skeletons only when there is nothing to show yet — a reload keeps the old rows. */
  protected readonly loading = computed(() => this.page.isLoading() && !this.page.hasValue());
  protected readonly failed = computed(() => this.page.error() !== undefined);

  protected readonly columns = computed<TableColumn[]>(() => {
    this.translations();
    const t = (key: string) => this.transloco.translate(`projects.columns.${key}`);
    return [
      // Sortable only where the server can actually sort: the field name travels to the
      // API, and offering a header it does not understand is a control that does nothing.
      { field: 'name', header: t('name'), sortable: true },
      { field: 'description', header: t('description'), sortable: false },
      { field: 'status', header: t('status'), sortable: false },
      {
        field: 'createdAt',
        header: t('createdAt'),
        sortable: true,
        pipe: 'date',
        pipeArgs: ['mediumDate'],
        removable: true,
      },
    ];
  });

  protected readonly actions = computed<TableAction<Project>[]>(() => {
    this.translations();
    return [
      {
        icon: 'lucideTrash2',
        severity: 'destructive',
        label: this.transloco.translate('common.delete'),
        visible: () => this.permissions.anyOf(PERMISSIONS.PROJECTS_DELETE),
        command: (row) => this.remove(row),
      },
    ];
  });

  protected asProject(value: unknown): Project {
    return value as Project;
  }

  protected onLazyLoad(event: DuiTablelazyLoadEvent): void {
    // An explicit reload asks for the same parameters again, and the equality above is
    // built to ignore exactly that — so it is handled before the comparison.
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

  private remove(project: Project): void {
    void (async () => {
      try {
        await firstValueFrom(this.api.remove(project.id));
        this.page.reload();
        this.toasts.success('projects.deleted', { name: project.name });
      } catch (error: unknown) {
        // A hidden button is not a guarantee, so a refusal still has to be reported.
        this.toasts.error(error);
      }
    })();
  }
}
