import { Component, computed, effect, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronRight } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmSidebarImports } from '@spartan-ng/helm/sidebar';
import { MenuExpansionService } from './menu-expansion.service';

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
  children?: readonly ShellNavItem[];
}

/**
 * One block of the menu.
 *
 * `labelKey` is optional because the first block usually has no heading: whatever sits
 * above the first divider is the product itself, and naming it says nothing.
 */
export interface ShellNavSection {
  id: string;
  labelKey?: string;
  items: readonly ShellNavItem[];
}

/**
 * Application frame: collapsible sidebar, sticky header, scrolling content.
 *
 * Built on the spartan sidebar primitive rather than a hand-rolled `<nav>`: it brings
 * the icon-only collapsed state, the drag rail, the mobile sheet and the tooltips that
 * make that collapsed state usable — all of which would otherwise have to be written
 * and then maintained here.
 *
 * Driven entirely by inputs, so the decision about *what* a user may see stays where
 * the permission state lives. Everything about the signed-in person is projected into
 * `[shellHeaderEnd]`: the shell knows nothing about sessions.
 */
@Component({
  selector: 'dui-app-shell',
  imports: [RouterLink, RouterLinkActive, NgIcon, TranslocoPipe, HlmSidebarImports],
  providers: [provideIcons({ lucideChevronRight })],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  private readonly router = inject(Router);

  protected readonly expansion = inject(MenuExpansionService);

  readonly appName = input.required<string>();
  readonly sections = input.required<readonly ShellNavSection[]>();

  /** Single letter badge kept visible when the sidebar collapses to icons. */
  protected readonly initial = computed(() => this.appName().trim().charAt(0).toUpperCase() || '·');

  private readonly currentUrl = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Expandable entries containing the active route, across every section. */
  private readonly groupsToOpen = computed(() => {
    const url = this.currentUrl();
    return this.sections()
      .flatMap((section) => section.items)
      .filter((item) => item.children?.some((child) => url.startsWith(child.route)))
      .map((item) => item.id);
  });

  constructor() {
    // Open rather than toggle: navigating within a branch must not collapse it and
    // lose the context someone was working in.
    effect(() => {
      for (const id of this.groupsToOpen()) this.expansion.open(id);
    });
  }
}
