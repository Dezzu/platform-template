import { DOCUMENT, inject, Service, signal } from '@angular/core';

const STORAGE_KEY = 'dui-menu-open';
const COLLAPSED_STORAGE_KEY = 'dui-menu-collapsed';

/**
 * Remembers which parts of the menu the reader has opened or closed.
 *
 * The sidebar primitive already persists whether the sidebar itself is open or
 * icon-only; this covers the other half of the state, which would otherwise reset on
 * every reload and force someone to reopen the same branch dozens of times a day.
 *
 * Two sets, because the two things have opposite defaults and storing them together
 * would make an empty set mean "everything closed" for one and "everything open" for
 * the other:
 *
 * - a **submenu** starts closed, so the set holds what is OPEN;
 * - a **section** starts open — a menu that opens empty helps nobody — so its set
 *   holds what the reader has deliberately CLOSED.
 */
@Service()
export class MenuExpansionService {
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly openKeys = signal<ReadonlySet<string>>(this.read(STORAGE_KEY));
  private readonly collapsedKeys = signal<ReadonlySet<string>>(this.read(COLLAPSED_STORAGE_KEY));

  isOpen(key: string): boolean {
    return this.openKeys().has(key);
  }

  toggle(key: string): void {
    this.openKeys.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      this.write(STORAGE_KEY, next);
      return next;
    });
  }

  /** For the things that start open: true only once the reader has closed them. */
  isCollapsed(key: string): boolean {
    return this.collapsedKeys().has(key);
  }

  toggleCollapsed(key: string): void {
    this.collapsedKeys.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      this.write(COLLAPSED_STORAGE_KEY, next);
      return next;
    });
  }

  /** Opens without toggling, so navigating inside a branch never collapses it. */
  open(key: string): void {
    if (this.openKeys().has(key)) return;
    this.openKeys.update((current) => {
      const next = new Set(current).add(key);
      this.write(STORAGE_KEY, next);
      return next;
    });
  }

  private read(storageKey: string): ReadonlySet<string> {
    try {
      const raw = this.storage?.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
    } catch {
      // Corrupt or unavailable storage is not worth failing a page load over.
      return new Set();
    }
  }

  private write(storageKey: string, keys: ReadonlySet<string>): void {
    try {
      this.storage?.setItem(storageKey, JSON.stringify([...keys]));
    } catch {
      // Private browsing and full quotas both throw here; the menu still works.
    }
  }
}
