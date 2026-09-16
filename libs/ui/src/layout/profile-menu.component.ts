import { Component, computed, inject, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { ThemeService } from '../mix/theme.service';

/** An extra menu entry; the caller supplies the icon through `provideIcons`. */
export interface ProfileMenuEntry {
  /** i18n key, never a display string. */
  labelKey: string;
  icon: string;
  action: () => void;
}

/**
 * The signed-in person's menu: who you are, the theme, the way out.
 *
 * Presentational on purpose — it takes strings and emits an event — so it can live
 * here without libs/ui knowing anything about authentication. Different applications
 * show different things in the header but share this mechanism, and two copies would
 * have diverged on the first change.
 *
 * Sign out sits below a separator and is the only destructive-coloured entry: it is
 * the one action here you cannot undo with another click, so it should not sit
 * shoulder to shoulder with changing the theme.
 */
@Component({
  selector: 'dui-profile-menu',
  imports: [NgIcon, TranslocoPipe, HlmAvatarImports, HlmButtonImports, HlmDropdownMenuImports],
  providers: [provideIcons({ lucideLogOut, lucideSun, lucideMoon })],
  template: `
    <button
      hlmBtn
      variant="ghost"
      type="button"
      class="h-9 gap-2 px-1.5"
      align="end"
      [hlmDropdownMenuTrigger]="profileMenu"
      [attr.aria-label]="'profile.menuFor' | transloco: { name: name() }"
    >
      <hlm-avatar class="size-7">
        @if (avatarUrl(); as url) {
          <img hlmAvatarImage [src]="url" [alt]="name()" />
        }
        <span hlmAvatarFallback class="text-xs">{{ initials() }}</span>
      </hlm-avatar>

      <!-- On narrow screens only the avatar remains: the name would eat the whole bar. -->
      <span class="hidden max-w-[12rem] truncate text-sm font-medium sm:inline">{{ name() }}</span>
    </button>

    <ng-template #profileMenu>
      <hlm-dropdown-menu class="w-60">
        <div hlmDropdownMenuLabel class="flex flex-col gap-0.5">
          <span class="truncate font-medium">{{ name() }}</span>
          @if (email(); as address) {
            <span class="text-muted-foreground truncate text-xs font-normal">{{ address }}</span>
          }
        </div>

        <hlm-dropdown-menu-separator />

        <hlm-dropdown-menu-group>
          @for (entry of entries(); track entry.labelKey) {
            <button hlmDropdownMenuItem type="button" (click)="entry.action()">
              <ng-icon [name]="entry.icon" />
              {{ entry.labelKey | transloco }}
            </button>
          }

          <button hlmDropdownMenuItem type="button" (click)="theme.toggle()">
            <ng-icon [name]="isDark() ? 'lucideSun' : 'lucideMoon'" />
            {{ (isDark() ? 'theme.switchToLight' : 'theme.switchToDark') | transloco }}
          </button>
        </hlm-dropdown-menu-group>

        <hlm-dropdown-menu-separator />

        <button hlmDropdownMenuItem type="button" class="text-destructive" (click)="signOut.emit()">
          <ng-icon name="lucideLogOut" />
          {{ 'auth.signOut' | transloco }}
        </button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class ProfileMenuComponent {
  protected readonly theme = inject(ThemeService);

  readonly name = input.required<string>();
  readonly email = input<string>();
  readonly avatarUrl = input<string>();
  readonly entries = input<readonly ProfileMenuEntry[]>([]);

  readonly signOut = output<void>();

  protected readonly isDark = computed(() => this.theme.resolved() === 'dark');

  /** Initials, as the fallback when there is no picture. */
  protected readonly initials = computed(() => {
    const [first, second] = this.name().trim().split(/\s+/).filter(Boolean);
    if (!first) return '?';
    return (first.charAt(0) + (second?.charAt(0) ?? '')).toUpperCase();
  });
}
