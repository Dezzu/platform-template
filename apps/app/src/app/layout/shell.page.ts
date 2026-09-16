import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AuthService, NAV_MANIFEST, PermissionsService } from '@app/core';
import { AppShellComponent, type ShellNavItem } from '@app/ui/layout';
import { environment } from '../../environments/environment';

/**
 * Feeds the presentational shell.
 *
 * The filtering happens here, where the permission state lives: libs/ui receives the
 * entries that should be visible and knows nothing about who may see what. Because the
 * filter reads NAV_MANIFEST — the same array `navGuard()` reads — the sidebar cannot
 * offer a link the router would refuse.
 */
@Component({
  selector: 'app-shell-page',
  imports: [RouterOutlet, AppShellComponent],
  template: `
    <dui-app-shell
      [appName]="appName"
      [items]="visibleItems()"
      [contextLabel]="organizationLabel()"
      (signOut)="signOut()"
    >
      <router-outlet />
    </dui-app-shell>
  `,
})
export class ShellPage {
  private readonly permissions = inject(PermissionsService);
  private readonly auth = inject(AuthService);

  protected readonly appName = environment.appName;

  protected readonly visibleItems = computed<ShellNavItem[]>(() =>
    NAV_MANIFEST.filter((item) => {
      const required = item.permissions ?? [];
      if (required.length === 0) return true;
      return item.mode === 'all'
        ? this.permissions.allOf(...required)
        : this.permissions.anyOf(...required);
    }).map(({ id, labelKey, icon, route }) => ({ id, labelKey, icon, route })),
  );

  protected readonly organizationLabel = computed(() => this.auth.user()?.email ?? null);

  protected signOut(): void {
    void this.auth.signOut();
  }
}
