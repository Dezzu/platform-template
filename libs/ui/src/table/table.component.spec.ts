import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { provideI18n } from '@app/i18n';
import type { DuiTablelazyLoadEvent, TableAction, TableColumn } from '../mix/base.model';
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

const labelAt = (
  fixture: { componentInstance: unknown },
  actions: TableAction<Row>[],
  index: number,
): string | null =>
  (
    fixture.componentInstance as unknown as {
      groupLabel: (a: TableAction<Row>[], i: number) => string | null;
    }
  ).groupLabel(actions, index);

describe('TableComponent', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('marks the reload button as a reload, so an unchanged request still fires', async () => {
    const fixture = setup();
    fixture.componentRef.setInput('lazy', true);
    await fixture.whenStable();

    const emitted: DuiTablelazyLoadEvent[] = [];
    fixture.componentInstance.onLazyLoad.subscribe((event) => emitted.push(event));

    (fixture.componentInstance as unknown as { reload: () => void }).reload();
    await fixture.whenStable();

    expect(emitted).toHaveLength(1);
    // Without the flag a caller that keys its request off page, sort and search sees
    // no change and does nothing — which is a button that looks like it works.
    expect(emitted[0]?.reload).toBe(true);
  });

  /**
   * The button is rendered in both modes, so it has to work in both.
   *
   * It did not: `reload()` only ever emitted `onLazyLoad`, which a table holding its own
   * rows has no reason to bind — so on the members and privacy screens the press went
   * nowhere and nothing happened. A button that silently does nothing is the failure
   * this repository keeps finding by opening the page, and this is the cheap guard.
   */
  it('announces a reload even when the table is not lazy', async () => {
    const fixture = setup();
    fixture.componentRef.setInput('lazy', false);
    await fixture.whenStable();

    let reloads = 0;
    const lazyEvents: DuiTablelazyLoadEvent[] = [];
    fixture.componentInstance.reloaded.subscribe(() => (reloads += 1));
    fixture.componentInstance.onLazyLoad.subscribe((event) => lazyEvents.push(event));

    (fixture.componentInstance as unknown as { reload: () => void }).reload();
    await fixture.whenStable();

    expect(reloads).toBe(1);
    // And no lazy event: a table that owns its rows has no page or sort to announce,
    // and a caller binding both would fetch twice.
    expect(lazyEvents).toHaveLength(0);
  });

  it('announces a reload to a lazy table too, alongside the lazy event', async () => {
    const fixture = setup();
    fixture.componentRef.setInput('lazy', true);
    await fixture.whenStable();

    let reloads = 0;
    fixture.componentInstance.reloaded.subscribe(() => (reloads += 1));

    (fixture.componentInstance as unknown as { reload: () => void }).reload();
    await fixture.whenStable();

    expect(reloads).toBe(1);
  });

  it('does not flag the ordinary state changes as reloads', async () => {
    const fixture = setup();
    fixture.componentRef.setInput('lazy', true);
    await fixture.whenStable();

    const emitted: DuiTablelazyLoadEvent[] = [];
    fixture.componentInstance.onLazyLoad.subscribe((event) => emitted.push(event));

    fixture.componentRef.setInput('rows', 20);
    await fixture.whenStable();

    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.every((event) => !event.reload)).toBe(true);
  });

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

  describe('where the actions column sits', () => {
    const cellsOf = (fixture: { nativeElement: unknown }) => [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('tbody tr')[0]!.children,
    ];

    it('puts it last by default, where a reader expects it', async () => {
      const fixture = setup([action('Elimina')]);
      await fixture.whenStable();

      const cells = cellsOf(fixture);
      expect(cells.at(-1)?.querySelector('button')).not.toBeNull();
      expect(cells[0]?.textContent).toContain('Acme');
    });

    it('puts it first when asked, ahead of every column', async () => {
      const fixture = setup([action('Elimina')]);
      fixture.componentRef.setInput('actionsPosition', 'start');
      await fixture.whenStable();

      const cells = cellsOf(fixture);
      expect(cells[0]?.querySelector('button')).not.toBeNull();
      // And the data still starts where the data starts.
      expect(cells[1]?.textContent).toContain('Acme');
    });

    it('moves the header with it, so the columns still line up', async () => {
      const fixture = setup([action('Elimina')]);
      fixture.componentRef.setInput('actionsPosition', 'start');
      await fixture.whenStable();

      const headers = [...(fixture.nativeElement as HTMLElement).querySelectorAll('thead th')];
      // A header row one cell out of step with the body is a table that reads wrong
      // for every row at once.
      expect(headers).toHaveLength(cellsOf(fixture).length);
      expect(headers[0]?.textContent).toContain('Azioni');
    });
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
      // The boundary itself is still a boundary, in either direction — though a menu
      // that goes back to non-destructive is a menu in the wrong order.
      expect(separatorAt(fixture, actions, 1)).toBe(true);
    });

    it('divides named groups, and titles each one once', () => {
      const actions = [
        { ...action('Utente'), group: 'Ruolo di piattaforma' },
        { ...action('Amministratore'), group: 'Ruolo di piattaforma' },
        { ...action('Invia reset'), group: 'Account' },
      ];
      const fixture = setup(actions);

      expect(separatorAt(fixture, actions, 1)).toBe(false);
      expect(separatorAt(fixture, actions, 2)).toBe(true);

      // The heading belongs to the first entry of its group, not to every entry.
      expect(labelAt(fixture, actions, 0)).toBe('Ruolo di piattaforma');
      expect(labelAt(fixture, actions, 1)).toBeNull();
      expect(labelAt(fixture, actions, 2)).toBe('Account');
    });

    it('leaves an ungrouped action without a heading', () => {
      const actions = [action('Modifica'), action('Elimina', 'destructive')];
      const fixture = setup(actions);

      expect(labelAt(fixture, actions, 0)).toBeNull();
      // Red and behind a line already says what it is; a title would add nothing.
      expect(labelAt(fixture, actions, 1)).toBeNull();
    });
  });
});
