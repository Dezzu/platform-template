import { DOCUMENT, inject, Service, signal } from '@angular/core';

const STORAGE_KEY = 'dui-menu-open';

/**
 * Remembers which menu groups are expanded.
 *
 * The sidebar primitive already persists whether the sidebar itself is open or
 * icon-only; this covers the other half of the state, which would otherwise reset on
 * every reload and force someone to reopen the same branch dozens of times a day.
 */
@Service()
export class MenuExpansionService {
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly openKeys = signal<ReadonlySet<string>>(this.read());

  isOpen(key: string): boolean {
    return this.openKeys().has(key);
  }

  toggle(key: string): void {
    this.openKeys.update((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      this.write(next);
      return next;
    });
  }

  /** Opens without toggling, so navigating inside a branch never collapses it. */
  open(key: string): void {
    if (this.openKeys().has(key)) return;
    this.openKeys.update((current) => {
      const next = new Set(current).add(key);
      this.write(next);
      return next;
    });
  }

  private read(): ReadonlySet<string> {
    try {
      const raw = this.storage?.getItem(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : []);
    } catch {
      // Corrupt or unavailable storage is not worth failing a page load over.
      return new Set();
    }
  }

  private write(keys: ReadonlySet<string>): void {
    try {
      this.storage?.setItem(STORAGE_KEY, JSON.stringify([...keys]));
    } catch {
      // Private browsing and full quotas both throw here; the menu still works.
    }
  }
}
