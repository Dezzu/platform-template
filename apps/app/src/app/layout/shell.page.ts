import { Component, computed, DestroyRef, DOCUMENT, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import {
  AuthService,
  CanPlatformDirective,
  FeatureFlagsService,
  NotificationCenterService,
  NAV_MANIFEST,
  NAV_SECTIONS,
  PermissionsService,
  ToastService,
} from '@app/core';
import { NotificationBellComponent } from '../features/notifications/notification-bell.component';
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
  imports: [
    RouterOutlet,
    RouterLink,
    AppShellComponent,
    ProfileMenuComponent,
    CanPlatformDirective,
    NotificationBellComponent,
    TranslocoPipe,
    HlmButtonImports,
  ],
  template: `
    <dui-app-shell [appName]="appName" [sections]="visibleSections()">
      <app-notification-bell shellHeaderEnd />

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

      <!--
        The product is closed and this account is one of the few still let in. Said
        permanently, for the same reason the impersonation notice is: an administrator
        who forgets that customers are looking at a maintenance page is an
        administrator who leaves it up.
      -->
      @if (maintenance(); as notice) {
        <div
          class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-100 px-4 py-2 text-sm text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          <span>
            {{ 'maintenance.activeNotice' | transloco }}
            @if (notice.messageKey) {
              <span class="opacity-80">— {{ notice.messageKey | transloco }}</span>
            }
          </span>
          <a
            hlmBtn
            size="sm"
            variant="secondary"
            routerLink="/admin/maintenance"
            *appCanPlatform="['platform.maintenance.manage']"
          >
            {{ 'maintenance.manage' | transloco }}
          </a>
        </div>
      }

      <router-outlet />
    </dui-app-shell>
  `,
})
export class ShellPage {
  private readonly permissions = inject(PermissionsService);
  private readonly flags = inject(FeatureFlagsService);
  private readonly centre = inject(NotificationCenterService);
  private readonly toasts = inject(ToastService);
  private readonly document = inject(DOCUMENT);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;
  protected readonly user = this.auth.user;
  constructor() {
    /**
     * Primed once here rather than by the bell: the badge has to be right before
     * anybody presses anything, and the bell only fetches its list when opened.
     *
     * Then the live connection, which is what keeps it right. Opened here and closed
     * with the shell, so it exists exactly while somebody is signed in and looking:
     * the screens outside the shell have no bell to update, and a stream left open
     * after sign-out is a held request against a session that no longer exists.
     */
    void this.centre.refresh();
    this.centre.connect();
    inject(DestroyRef).onDestroy(() => this.centre.disconnect());
  }

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
    {
      // Here rather than in the sidebar: it is about the person, not about the tenant,
      // and it is the first place somebody looks when they want out.
      labelKey: 'privacy.title',
      icon: 'lucideLockKeyhole',
      action: () => void this.router.navigateByUrl('/privacy'),
    },
  ];

  private readonly visibleItems = computed<(ShellNavItem & { section?: string })[]>(() =>
    NAV_MANIFEST.filter((item) => {
      const modes = item.modes;
      if (modes && !modes.includes(this.permissions.mode())) return false;

      // The same rule navGuard() applies, so the sidebar cannot offer a link the
      // router refuses — which is the whole reason both read this one array.
      const flag = item.featureFlag;
      if (flag && !this.flags.enabled(flag)) return false;

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
  /** Non-null only when maintenance is on AND this account was let through anyway. */
  protected readonly maintenance = computed(() => this.permissions.maintenance());
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
      await this.auth.stopImpersonating();
      // A literal rather than an import: after this the shell must know nothing about
      // the administration area, and a URL is not a dependency. Whoever was
      // impersonating necessarily holds the rights to land here.
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
