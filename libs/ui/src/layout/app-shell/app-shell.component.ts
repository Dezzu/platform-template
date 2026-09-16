import { Component, input, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideMenu, lucideX } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSeparatorImports } from '@spartan-ng/helm/separator';

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
 *
 * Everything about the signed-in person — profile, theme, signing out — is projected
 * into `[shellHeaderEnd]` rather than built here: the shell knows nothing about
 * sessions, and one control in the corner beats three scattered buttons.
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
  providers: [provideIcons({ lucideMenu, lucideX })],
  host: { class: 'flex min-h-screen w-full bg-background text-foreground' },
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  readonly appName = input.required<string>();
  readonly items = input.required<readonly ShellNavItem[]>();

  protected readonly mobileOpen = signal(false);

  protected closeMobile(): void {
    this.mobileOpen.set(false);
  }
}
