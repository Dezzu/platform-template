import type { ButtonVariants } from '@spartan-ng/helm/button';

/** Button variants, straight from the helm button. */
export type ButtonSeverity = NonNullable<ButtonVariants['variant']>;

/**
 * Lazy-load event emitted by `dui-table`.
 *
 * Only the fields the table actually produces — a page index, a page size, the sort
 * and the global filter. Everything the caller needs to build a request is in
 * `pageRequest`.
 */
export interface TableLazyLoadEvent {
  /** Index of the first row of the requested page. */
  first?: number;
  /** Rows per page. */
  rows?: number;
  sortField?: string | string[] | null;
  /** 1 ascending, -1 descending. */
  sortOrder?: number | null;
  /** Global filter text. */
  globalFilter?: string | string[] | null;
}

export interface TableColumn {
  field: string;
  header: string;
  sortable?: boolean;
  /** The user may hide this column from the column selector. */
  removable?: boolean;
  /** Hidden until the user asks for it. */
  defaultRemoved?: boolean;
  suffix?: string;
  /** Name of a pipe applied to the cell value, resolved through DynamicPipe. */
  pipe?: string;
  pipeArgs?: unknown[];
}

export interface TableAction<T> {
  icon: string | ((row: T, rows: T[]) => string);
  class?: string;
  severity?: ButtonSeverity;
  command: (row: T, rows: T[]) => void;
  disabled?: (row: T, rows: T[]) => boolean;
  visible?: (row: T, rows: T[]) => boolean;
  tooltip?: string;

  /**
   * Text of the entry when the actions live in a menu (`actionsAsMenu`).
   *
   * Without it `tooltip` is used: it already describes the action, and for a menu row
   * that is usually fine. This exists for when the tooltip is long — "Set a new
   * password" — and the menu entry wants to be shorter.
   */
  label?: string | ((row: T, rows: T[]) => string);
}

export interface AppPage {
  totalElements: number;
  currentPage: number;
  pageSize: number;
}

export interface PageRequest {
  size: number;
  page: number;
  sortOrder?: number | null;
  sortField?: string | string[] | null;
  query?: string | string[] | null;
}

export interface DuiTablelazyLoadEvent extends TableLazyLoadEvent {
  pageRequest: PageRequest;
}
