import {
  CurrencyPipe,
  DatePipe,
  DecimalPipe,
  NgTemplateOutlet,
  UpperCasePipe,
} from '@angular/common';
import {
  Component,
  computed,
  contentChildren,
  effect,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { debounce, timer } from 'rxjs';
import {
  lucideArrowDown,
  lucideArrowUp,
  lucideChevronDown,
  lucideChevronRight,
  lucideChevronsUpDown,
  lucideEllipsisVertical,
  lucideInbox,
  lucidePlus,
  lucideRefreshCw,
  lucideSearch,
} from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmEmptyImports } from '@spartan-ng/helm/empty';
import { HlmNumberedPagination } from '@spartan-ng/helm/pagination';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSkeletonImports } from '@spartan-ng/helm/skeleton';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { HlmTableImports } from '@spartan-ng/helm/table';
import { TranslocoPipe } from '@jsverse/transloco';
import { TextInputComponent } from '../input/text-input/text-input.component';
import {
  type DuiTablelazyLoadEvent,
  type PageRequest,
  type TableAction,
  type TableColumn,
  type TableLazyLoadEvent,
} from '../mix/base.model';
import { DynamicPipe } from '../mix/dynamic.pipe';
import { TemplateDirective } from '../mix/template.directive';
import { compareValues, getFieldValue, matchesFilter, type SortState } from './table-state';

/**
 * Tabella dati.
 *
 * `hlm-table` supplies styling directives only: sorting, filtering, pagination,
 * column selection and expandable rows are implemented here with signals. In `lazy`
 * mode the state is merely announced through `onLazyLoad` and the data comes from the
 * caller; with `lazy = false` the table filters, sorts and
 * pagina da sola sull'array `items`.
 *
 * Sortable headers are real `<button>` elements with `aria-sort` on the `<th>`,
 * rather than clickable `<th>` cells.
 */
@Component({
  selector: 'dui-table',
  imports: [
    NgTemplateOutlet,
    FormsModule,
    NgIcon,
    HlmTableImports,
    HlmButtonImports,
    HlmDropdownMenuImports,
    HlmSelectImports,
    HlmSkeletonImports,
    HlmEmptyImports,
    HlmNumberedPagination,
    TextInputComponent,
    DynamicPipe,
    TranslocoPipe,
  ],
  providers: [
    provideIcons({
      lucideSearch,
      lucidePlus,
      lucideRefreshCw,
      lucideArrowUp,
      lucideArrowDown,
      lucideChevronsUpDown,
      lucideChevronRight,
      lucideChevronDown,
      lucideInbox,
      lucideEllipsisVertical,
    }),
    DatePipe,
    DecimalPipe,
    CurrencyPipe,
    UpperCasePipe,
  ],
  host: { class: 'block' },
  templateUrl: './table.component.html',
})
export class TableComponent<T> {
  private readonly templates = contentChildren(TemplateDirective);

  readonly cols = input<TableColumn[]>([]);
  readonly items = input<T[]>([]);
  readonly lazy = input(true);
  readonly rows = input(10);
  readonly rowsPerPageOptions = input<number[]>([5, 10, 20, 30]);
  readonly paginator = input(true);
  readonly loading = input(false);
  readonly totalRecords = input(0);
  readonly actions = input<TableAction<T>[]>([]);

  /**
   * Which side the actions column sits on.
   *
   * 'end' by default, where a reader expects it. 'start' is for a table whose rows are
   * *acted on* more often than they are read — put the control under the cursor rather
   * than at the far side of a row whose width depends on the data in it.
   */
  readonly actionsPosition = input<'start' | 'end'>('end');
  readonly expandable = input(false);
  readonly dataKey = input<string>();
  readonly title = input<string>();

  /** Heading level of the title within the page hierarchy: avoids jumping from h2 to h5. */
  readonly titleLevel = input(3);
  readonly simpleTable = input(false);
  readonly showAddButton = input(true);

  /**
   * Raccoglie le azioni di riga dietro i tre puntini invece di allinearle.
   *
   * Turn this on when there are more than two actions, or when icons alone do not
   * tell them apart: a row of symbols forces you to hover each one to discover what
   * it does, whereas a menu says it in words. With one or two obvious actions the
   * row is better — it takes a single click.
   */
  readonly actionsAsMenu = input(false);
  readonly showSearch = input(true);
  readonly showColumnSelector = input(true);
  /** i18n key, not a sentence — it is piped through transloco in the template. */
  readonly emptyMessage = input('table.empty');

  /** Attesa prima di propagare il filtro globale, in millisecondi. */
  readonly filterDelay = input(300);

  readonly onLazyLoad = output<DuiTablelazyLoadEvent>();
  readonly openNew = output<void>();

  /**
   * The reload button was pressed.
   *
   * Separate from `onLazyLoad` because the button is rendered in **both** modes while
   * that output is only meaningful in one. A table driven by `[lazy]="false"` holds its
   * own rows, has no page or sort to announce, and its caller has no reason to bind
   * something called "lazy load" — so the press went nowhere and the button did nothing.
   * It did exactly that on the members and privacy screens.
   *
   * Lazy callers keep binding `onLazyLoad`, which still carries `reload: true`; callers
   * that own their data bind this.
   */
  readonly reloaded = output<void>();

  /**
   * Announces which row was opened or closed.
   *
   * Expansion state stays inside the table — it is presentation — but the detail of a
   * row is usually a second request, and without this the caller has no way to know it
   * is wanted. Fetching every row's detail up front so that expanding is instant is the
   * alternative, and it is the wrong one on a list of any size.
   */
  readonly expandedChange = output<{ row: T; expanded: boolean }>();

  // ---- stato ----------------------------------------------------------------

  /** Pagina corrente, 1-based come vuole HlmNumberedPagination. */
  readonly page = signal(1);
  readonly rowsPerPage = linkedSignal(() => this.rows());
  readonly sort = signal<SortState>({ field: null, order: 1 });
  /** Text in the search box: updated on every keystroke so the input never lags. */
  readonly filter = signal('');

  /**
   * The debounced filter, and the one that actually drives loading. Without it every
   * keystroke would be a request to the backend.
   */
  private readonly debouncedFilter = toSignal(
    toObservable(this.filter).pipe(debounce(() => timer(this.filterDelay()))),
    { initialValue: '' },
  );
  readonly expanded = signal<ReadonlySet<unknown>>(new Set());

  /** Removable columns currently visible; recomputed when the column set changes. */
  readonly selectedFields = linkedSignal<TableColumn[], string[]>({
    source: () => this.cols(),
    computation: (cols, previous) => {
      const removable = cols.filter((c) => c.removable === undefined || c.removable);
      const defaults = removable.filter((c) => !c.defaultRemoved).map((c) => c.field);
      if (!previous) return defaults;
      // Preserve the user's choice for the columns that still exist.
      const kept = previous.value.filter((f) => removable.some((c) => c.field === f));
      return kept.length || previous.value.length ? kept : defaults;
    },
  });

  protected readonly removableColumns = computed(() =>
    this.cols().filter((c) => c.removable === undefined || c.removable),
  );

  protected readonly visibleColumns = computed(() => {
    const selected = this.selectedFields();
    return this.cols().filter(
      (c) => (c.removable !== undefined && !c.removable) || selected.includes(c.field),
    );
  });

  /**
   * Label of the column selector. As with dui-select-input, in multiple mode
   * Spartan passa qui l'intero array di valori, non i singoli.
   */
  protected readonly columnsToString = (value: unknown): string => {
    const fields = Array.isArray(value) ? value : [value];
    if (!fields.length) return '';
    if (fields.length === this.removableColumns().length) return 'Tutte le colonne';
    if (fields.length > 2) return `${fields.length} colonne selezionate`;
    return fields
      .map((f) => this.cols().find((c) => c.field === f)?.header ?? String(f))
      .join(', ');
  };

  protected readonly colspan = computed(
    () =>
      this.visibleColumns().length + (this.actions().length ? 1 : 0) + (this.expandable() ? 1 : 0),
  );

  // ---- dati -----------------------------------------------------------------

  /** In lazy i dati arrivano gia' pronti; altrimenti filtra e ordina qui. */
  private readonly processed = computed(() => {
    if (this.lazy()) return this.items();

    const query = this.debouncedFilter();
    const columns = this.visibleColumns();
    const filtered = query
      ? this.items().filter((row) => matchesFilter(row, columns, query))
      : this.items();

    const { field, order } = this.sort();
    if (!field) return filtered;

    return [...filtered].sort(
      (a, b) => compareValues(getFieldValue(a, field), getFieldValue(b, field)) * order,
    );
  });

  protected readonly displayedRows = computed(() => {
    if (this.lazy() || !this.paginator()) return this.processed();
    const start = (this.page() - 1) * this.rowsPerPage();
    return this.processed().slice(start, start + this.rowsPerPage());
  });

  protected readonly total = computed(() =>
    this.lazy() ? this.totalRecords() : this.processed().length,
  );

  protected readonly skeletonRows = computed(() =>
    Array.from({ length: Math.min(this.rowsPerPage(), 5) }),
  );

  // ---- pipe dinamiche -------------------------------------------------------

  private readonly pipeMap: Record<string, unknown> = {
    date: DatePipe,
    decimal: DecimalPipe,
    currency: CurrencyPipe,
    uppercase: UpperCasePipe,
  };

  protected getPipeToken(pipeName?: string): unknown {
    return pipeName ? (this.pipeMap[pipeName] ?? null) : null;
  }

  // ---- lazy load ------------------------------------------------------------

  private lastEvent: TableLazyLoadEvent | undefined;

  constructor() {
    // A single emission point: any state change re-issues the request.
    effect(() => {
      const page = this.page();
      const rows = this.rowsPerPage();
      const { field, order } = this.sort();
      const query = this.debouncedFilter();

      if (!untracked(() => this.lazy())) return;

      this.emitLazyLoad({
        first: (page - 1) * rows,
        rows,
        sortField: field,
        sortOrder: field ? order : null,
        globalFilter: query || null,
      });
    });
  }

  private emitLazyLoad(event: TableLazyLoadEvent, reload = false): void {
    this.lastEvent = event;
    const pageRequest: PageRequest = {
      size: event.rows!,
      page: event.first! / event.rows!,
      sortField: event.sortField,
      sortOrder: event.sortOrder,
      query: event.globalFilter,
    };
    this.onLazyLoad.emit({ ...event, pageRequest, ...(reload ? { reload: true } : {}) });
  }

  /**
   * Reloads while keeping the current state.
   *
   * `reloaded` always fires; the lazy-load event only when the table is actually lazy.
   * It is flagged as a reload, because the state it emits is by definition the state the
   * caller already has: without saying so, a caller that compares parameters before
   * fetching sees no change and the button does nothing.
   */
  reload(): void {
    this.reloaded.emit();

    if (!this.lazy()) return;

    const event =
      this.lastEvent ??
      ({ first: 0, rows: this.rowsPerPage(), sortField: null, sortOrder: null } as const);
    this.emitLazyLoad(event, true);
  }

  // ---- interazioni ----------------------------------------------------------

  protected toggleSort(col: TableColumn): void {
    if (col.sortable === false) return;
    this.sort.update(({ field, order }) =>
      field === col.field
        ? { field, order: (order === 1 ? -1 : 1) as 1 | -1 }
        : { field: col.field, order: 1 },
    );
    this.page.set(1);
  }

  protected sortIcon(col: TableColumn): string {
    const { field, order } = this.sort();
    if (field !== col.field) return 'lucideChevronsUpDown';
    return order === 1 ? 'lucideArrowUp' : 'lucideArrowDown';
  }

  protected ariaSort(col: TableColumn): 'ascending' | 'descending' | 'none' | null {
    if (col.sortable === false) return null;
    const { field, order } = this.sort();
    if (field !== col.field) return 'none';
    return order === 1 ? 'ascending' : 'descending';
  }

  protected onFilterChange(value: string | null | undefined): void {
    this.filter.set(value ?? '');
    this.page.set(1);
  }

  protected rowKey(row: T, index: number): unknown {
    const key = this.dataKey();
    return key ? getFieldValue(row, key) : index;
  }

  protected isExpanded(row: T, index: number): boolean {
    return this.expanded().has(this.rowKey(row, index));
  }

  protected toggleExpanded(row: T, index: number): void {
    const key = this.rowKey(row, index);
    let opened = false;

    this.expanded.update((current) => {
      const next = new Set(current);
      opened = !next.delete(key);
      if (opened) next.add(key);
      return next;
    });

    this.expandedChange.emit({ row, expanded: opened });
  }

  // ---- template e azioni ----------------------------------------------------

  protected templateFor(name: string) {
    return this.templates().find((t) => t.name() === name)?.template ?? null;
  }

  protected value(row: T, field: string): unknown {
    return getFieldValue(row, field);
  }

  protected actionIcon(action: TableAction<T>, row: T): string {
    return typeof action.icon === 'string' ? action.icon : action.icon(row, this.items());
  }

  protected actionVariant(action: TableAction<T>) {
    return action.severity ?? 'default';
  }

  protected actionVisible(action: TableAction<T>, row: T): boolean {
    return action.visible === undefined || action.visible(row, this.items());
  }

  protected actionDisabled(action: TableAction<T>, row: T): boolean {
    return action.disabled !== undefined && action.disabled(row, this.items());
  }

  /** Text of the menu entry: `label` when present, otherwise the tooltip. */
  protected actionLabel(action: TableAction<T>, row: T): string {
    if (typeof action.label === 'function') return action.label(row, this.items());
    return action.label ?? action.tooltip ?? '';
  }

  /**
   * The actions this row actually shows.
   *
   * Calcolate una volta sola: servono a decidere se disegnare i tre puntini —
   * on a row with no actions that would be a button opening an empty menu — and
   * poi a riempirli.
   */
  protected visibleActions(row: T): TableAction<T>[] {
    return this.actions().filter((action) => this.actionVisible(action, row));
  }

  /** Destructive actions stay red inside the menu too. */
  protected actionMenuClass(action: TableAction<T>): string {
    const variante = this.actionVariant(action);
    return variante === 'destructive' ? 'text-destructive' : '';
  }

  /**
   * Which block of the menu an action belongs to.
   *
   * A declared `group` wins; otherwise severity decides, so "destructive actions sit at
   * the bottom, behind a line" stays a convention the component keeps on its own — a
   * table that declares no groups at all still gets the divider.
   */
  private sectionOf(action: TableAction<T>): string {
    if (action.group) return `group:${action.group}`;
    return this.actionVariant(action) === 'destructive' ? 'destructive' : 'default';
  }

  /**
   * Whether a divider goes above this entry: exactly where one block ends and the next
   * begins, and never at the top, where it would separate the menu from nothing.
   */
  protected needsSeparator(actions: TableAction<T>[], index: number): boolean {
    if (index === 0) return false;
    const current = actions[index];
    const previous = actions[index - 1];
    if (!current || !previous) return false;
    return this.sectionOf(current) !== this.sectionOf(previous);
  }

  /** The heading above this entry, or null when it is not the first of its group. */
  protected groupLabel(actions: TableAction<T>[], index: number): string | null {
    const current = actions[index];
    if (!current?.group) return null;
    const previous = index > 0 ? actions[index - 1] : undefined;
    return previous?.group === current.group ? null : current.group;
  }
}
