import { DOCUMENT, effect, inject, Service, signal } from '@angular/core';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'dui-theme';

/**
 * Tema chiaro/scuro.
 *
 * The theme tokens define a `:root.dark` variant, but something has to toggle that
 * class — without this service the dark theme is unreachable. The preference is
 * persisted, and `system` follows the operating system setting.
 */
@Service()
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<Theme>(this.readStored());

  /** Tema effettivamente applicato, risolvendo `system`. */
  readonly resolved = signal<'light' | 'dark'>('light');

  constructor() {
    const media = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const theme = this.theme();
      const dark = theme === 'dark' || (theme === 'system' && !!media?.matches);
      this.document.documentElement.classList.toggle('dark', dark);
      this.resolved.set(dark ? 'dark' : 'light');
    };

    effect(() => {
      apply();
      this.document.defaultView?.localStorage?.setItem(STORAGE_KEY, this.theme());
    });

    // Following the system means following it when it changes at runtime too.
    media?.addEventListener('change', () => {
      if (this.theme() === 'system') apply();
    });
  }

  toggle(): void {
    this.theme.set(this.resolved() === 'dark' ? 'light' : 'dark');
  }

  private readStored(): Theme {
    const stored = this.document.defaultView?.localStorage?.getItem(STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  }
}
