import { Component, computed, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { lucideUser } from '@ng-icons/lucide';
import { TranslocoService } from '@jsverse/transloco';
import { AuthService, NAV_MANIFEST, PermissionsService } from '@app/core';
import {
  AppShellComponent,
  ProfileMenuComponent,
  type ProfileMenuEntry,
  type ShellNavItem,
} from '@app/ui/layout';
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
  imports: [RouterOutlet, AppShellComponent, ProfileMenuComponent],
  providers: [provideIcons({ lucideUser })],
  template: `
    <dui-app-shell [appName]="appName" [items]="visibleItems()">
      <dui-profile-menu
        shellHeaderEnd
        [name]="displayName()"
        [email]="user()?.email ?? ''"
        [subtitle]="roleLabel()"
        [avatarUrl]="user()?.image ?? ''"
        [entries]="menuEntries"
        (signOut)="signOut()"
      />

      <router-outlet />
    </dui-app-shell>
  `,
})
export class ShellPage {
  private readonly permissions = inject(PermissionsService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly transloco = inject(TranslocoService);

  protected readonly appName = environment.appName;
  protected readonly user = this.auth.user;

  protected readonly displayName = computed(() => {
    const current = this.user();
    // Falls back to the address so the avatar never shows "?" for an account created
    // without a name.
    return current?.name?.trim() || current?.email || '';
  });

  protected readonly roleLabel = computed(() => {
    const role = this.permissions.role();
    // Translated here rather than in the menu: the component takes plain strings, so
    // it stays usable from a context that has no role at all.
    return role ? this.transloco.translate(`roles.${role}`) : '';
  });

  protected readonly menuEntries: readonly ProfileMenuEntry[] = [
    {
      labelKey: 'profile.title',
      icon: 'lucideUser',
      action: () => void this.router.navigateByUrl('/profile'),
    },
  ];

  protected readonly visibleItems = computed<ShellNavItem[]>(() =>
    NAV_MANIFEST.filter((item) => {
      const required = item.permissions ?? [];
      if (required.length === 0) return true;
      return item.mode === 'all'
        ? this.permissions.allOf(...required)
        : this.permissions.anyOf(...required);
    }).map(({ id, labelKey, icon, route }) => ({ id, labelKey, icon, route })),
  );

  protected signOut(): void {
    void this.auth.signOut();
  }
}
