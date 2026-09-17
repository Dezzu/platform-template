import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideI18n } from '@app/i18n';
import type { TableAction, TableColumn } from '../mix/base.model';
import { TableComponent } from './table.component';

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = [
  { id: '1', name: 'Acme' },
  { id: '2', name: 'Globex' },
];

const COLS: TableColumn[] = [{ field: 'name', header: 'Nome' }];

const action = (label: string, severity?: 'destructive'): TableAction<Row> => ({
  icon: 'lucideX',
  label,
  ...(severity ? { severity } : {}),
  command: () => {},
});

function setup(actions: TableAction<Row>[] = []) {
  TestBed.configureTestingModule({
    // A pagination primitive inside the table uses RouterLink.
    providers: [provideZonelessChangeDetection(), provideRouter([]), provideI18n('it')],
  });

  const fixture = TestBed.createComponent<TableComponent<Row>>(TableComponent);
  fixture.componentRef.setInput('cols', COLS);
  fixture.componentRef.setInput('items', ROWS);
  fixture.componentRef.setInput('lazy', false);
  fixture.componentRef.setInput('actions', actions);
  fixture.componentRef.setInput('actionsAsMenu', true);
  return fixture;
}

/** `needsSeparator` is protected; these cases are precisely about it. */
const separatorAt = (
  fixture: { componentInstance: unknown },
  actions: TableAction<Row>[],
  index: number,
): boolean =>
  (
    fixture.componentInstance as unknown as {
      needsSeparator: (a: TableAction<Row>[], i: number) => boolean;
    }
  ).needsSeparator(actions, index);

describe('TableComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('renders the rows it is given', async () => {
    const fixture = setup();
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Acme');
    expect(text).toContain('Globex');
  });

  it('translates its own chrome instead of shipping Italian to an English reader', async () => {
    const fixture = setup();
    await fixture.whenStable();

    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    // The keys themselves must never reach the screen.
    expect(html).not.toContain('table.reload');
    expect(html).not.toContain('table.search');
  });

  describe('the divider above the destructive actions', () => {
    it('goes exactly where the list turns destructive', () => {
      const actions = [action('Modifica'), action('Elimina', 'destructive')];
      const fixture = setup(actions);

      expect(separatorAt(fixture, actions, 0)).toBe(false);
      expect(separatorAt(fixture, actions, 1)).toBe(true);
    });

    it('does not repeat itself between two destructive actions', () => {
      const actions = [
        action('Modifica'),
        action('Disconnetti', 'destructive'),
        action('Elimina', 'destructive'),
      ];
      const fixture = setup(actions);

      expect(separatorAt(fixture, actions, 1)).toBe(true);
      // One line, not one per destructive entry.
      expect(separatorAt(fixture, actions, 2)).toBe(false);
    });

    it('never opens the menu with a line', () => {
      const actions = [action('Elimina', 'destructive'), action('Modifica')];
      const fixture = setup(actions);

      // Nothing above it to separate from.
      expect(separatorAt(fixture, actions, 0)).toBe(false);
      // And it does not appear when the list goes back to non-destructive either.
      expect(separatorAt(fixture, actions, 1)).toBe(false);
    });
  });
});
