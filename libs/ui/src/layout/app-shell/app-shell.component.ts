import { Component, computed, inject, input, output, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideMoon, lucideSun, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';
import { ThemeService } from '../../mix/theme.service';

/**
 * A menu entry as the shell needs it.
 *
 * Structurally compatible with `NavItem` from libs/core, without importing it: the
 * layering rules forbid libs/ui from depending on libs/core, and a presentational
 * shell has no business knowing about permissions anyway. The caller filters the
 * manifest and hands over what should be visible.
 */
export interface ShellNavItem {
  id: string;
  labelKey: string;
  icon: string;
  route: string;
}

/**
 * Application frame: sidebar, header, content.
 *
 * Driven entirely by inputs, so the decision about *what* a user may see stays where
 * the permission state lives. This component only renders what it is given.
 */
@Component({
  selector: 'dui-app-shell',
  imports: [
    RouterLink,
    RouterLinkActive,
    NgIcon,
    TranslocoPipe,
    HlmButtonImports,
    HlmSeparatorImports,
  ],
  providers: [provideIcons({ lucideMenu, lucideX, lucideSun, lucideMoon })],
  host: { class: 'flex min-h-screen w-full bg-background text-foreground' },
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly theme = inject(ThemeService);

  readonly appName = input.required<string>();
  readonly items = input.required<readonly ShellNavItem[]>();
  /** Shown above the menu; typically the active organization. */
  readonly contextLabel = input<string | null>(null);

  readonly signOut = output<void>();

  protected readonly mobileOpen = signal(false);
  protected readonly isDark = computed(() => this.theme.resolved() === 'dark');

  protected toggleTheme(): void {
    this.theme.toggle();
  }

  protected closeMobile(): void {
    this.mobileOpen.set(false);
  }
}
