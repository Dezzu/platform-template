import { Component, computed, DOCUMENT, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import {
  AuthService,
  NAV_MANIFEST,
  NAV_SECTIONS,
  PermissionsService,
  ToastService,
} from '@app/core';
import { AdminApi } from '../features/admin/admin.api';
import {
  AppShellComponent,
  ProfileMenuComponent,
  type ProfileMenuEntry,
  type ShellNavItem,
  type ShellNavSection,
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
  imports: [RouterOutlet, AppShellComponent, ProfileMenuComponent, TranslocoPipe, HlmButtonImports],
  template: `
    <dui-app-shell [appName]="appName" [sections]="visibleSections()">
      <dui-profile-menu
        shellHeaderEnd
        [name]="displayName()"
        [email]="user()?.email ?? ''"
        [avatarUrl]="user()?.image ?? ''"
        [entries]="menuEntries"
        (signOut)="signOut()"
      />

      <!--
        Permanent, and above everything: an administrator who forgets they are somebody
        else does damage in that person's name. It is not dismissible for the same
        reason — the way out is the button, not hiding the warning.
      -->
      @if (impersonating()) {
        <div
          class="bg-destructive text-destructive-foreground mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md px-4 py-2 text-sm"
          role="status"
        >
          <span>{{ 'admin.impersonatingNotice' | transloco: { who: user()?.email ?? '' } }}</span>
          <button
            hlmBtn
            size="sm"
            variant="secondary"
            type="button"
            [disabled]="leaving()"
            (click)="stopImpersonating()"
          >
            {{ (leaving() ? 'admin.leavingImpersonation' : 'admin.stopImpersonating') | transloco }}
          </button>
        </div>
      }

      <router-outlet />
    </dui-app-shell>
  `,
})
export class ShellPage {
  private readonly permissions = inject(PermissionsService);
  private readonly adminApi = inject(AdminApi);
  private readonly toasts = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;
  protected readonly user = this.auth.user;

  protected readonly displayName = computed(() => {
    const current = this.user();
    // Falls back to the address so the avatar never shows "?" for an account created
    // without a name.
    return current?.name?.trim() || current?.email || '';
  });

  protected readonly menuEntries: readonly ProfileMenuEntry[] = [
    {
      labelKey: 'profile.title',
      icon: 'lucideUser',
      action: () => void this.router.navigateByUrl('/profile'),
    },
  ];

  private readonly visibleItems = computed<(ShellNavItem & { section?: string })[]>(() =>
    NAV_MANIFEST.filter((item) => {
      const modes = item.modes;
      if (modes && !modes.includes(this.permissions.mode())) return false;

      const platform = item.platformPermissions ?? [];
      if (platform.length > 0 && !this.permissions.anyOfPlatform(...platform)) return false;

      const required = item.permissions ?? [];
      if (required.length === 0) return true;
      return item.mode === 'all'
        ? this.permissions.allOf(...required)
        : this.permissions.anyOf(...required);
    }).map(({ id, labelKey, icon, route, section }) => ({ id, labelKey, icon, route, section })),
  );

  /**
   * The visible entries, grouped.
   *
   * A section with nothing left in it disappears entirely — heading included. A plain
   * member sees no "Piattaforma" title above an empty gap, which is what filtering the
   * items without filtering the headings would produce.
   */
  protected readonly visibleSections = computed<ShellNavSection[]>(() => {
    const items = this.visibleItems();

    const ungrouped = items.filter((item) => !item.section);
    const sections: ShellNavSection[] = ungrouped.length ? [{ id: 'main', items: ungrouped }] : [];

    for (const section of NAV_SECTIONS) {
      const own = items.filter((item) => item.section === section.id);
      if (own.length > 0) {
        sections.push({ id: section.id, labelKey: section.labelKey, items: own });
      }
    }

    return sections;
  });

  /** True while a platform administrator is using the application as this account. */
  protected readonly impersonating = computed(() => this.permissions.impersonating());
  protected readonly leaving = signal(false);

  /**
   * Hands the administrator their own session back, then reloads.
   *
   * A full reload for the same reason entering did one: the cookie has been replaced,
   * and every signal in memory still describes the person who was being impersonated.
   */
  protected async stopImpersonating(): Promise<void> {
    if (this.leaving()) return;
    this.leaving.set(true);

    try {
      await firstValueFrom(this.adminApi.stopImpersonating());
      this.document.location.href = '/admin/users';
    } catch (error: unknown) {
      this.leaving.set(false);
      this.toasts.error(error);
    }
  }

  protected signOut(): void {
    void this.auth.signOut();
  }
}
