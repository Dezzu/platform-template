import { type TableColumn } from '../mix/base.model';

/** Current sort: 1 ascending, -1 descending. */
export interface SortState {
  field: string | null;
  order: 1 | -1;
}

/** Reads a field, nested paths included: `customer.address.city`. */
export function getFieldValue<T>(row: T, field: string): unknown {
  if (row == null) return null;
  if (!field.includes('.')) return (row as Record<string, unknown>)[field];

  let value: unknown = row;
  for (const segment of field.split('.')) {
    if (value == null || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[segment];
  }
  return value ?? null;
}

/** Generic comparison for client-side sorting. */
export function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;

  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  return String(a).localeCompare(String(b), 'it-IT', { numeric: true, sensitivity: 'base' });
}

/** Client-side global filter: searches every visible column. */
export function matchesFilter<T>(row: T, columns: TableColumn[], query: string): boolean {
  if (!query) return true;
  const needle = query.toLowerCase();
  return columns.some((col) => {
    const value = getFieldValue(row, col.field);
    return value != null && String(value).toLowerCase().includes(needle);
  });
}
