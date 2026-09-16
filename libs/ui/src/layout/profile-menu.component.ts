import { Component, computed, inject, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut, lucideMoon, lucideSun } from '@ng-icons/lucide';
import { HlmAvatarImports } from '@spartan-ng/helm/avatar';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmDropdownMenuImports } from '@spartan-ng/helm/dropdown-menu';
import { ThemeService } from '../mix/theme.service';

/** An extra menu entry; the caller supplies the icon through `provideIcons`. */
export interface ProfileMenuEntry {
  label: string;
  icona: string;
  azione: () => void;
}

/**
 * The signed-in person's menu: who you are, the theme, the way out.
 *
 * Presentazionale di proposito — riceve stringhe ed emette un evento — perché
 * so it can live here without `libs/ui` knowing anything about authentication.
 * Different apps show different things in the header but the same
 * meccanica, e due copie sarebbero divergute alla prima modifica.
 */
@Component({
  selector: 'dui-profilo-menu',
  imports: [NgIcon, HlmAvatarImports, HlmButtonImports, HlmDropdownMenuImports],
  providers: [provideIcons({ lucideLogOut, lucideSun, lucideMoon })],
  template: `
    <button
      hlmBtn
      variant="ghost"
      type="button"
      class="h-9 gap-2 px-1.5"
      align="end"
      [hlmDropdownMenuTrigger]="menuProfilo"
      [attr.aria-label]="'Menu di ' + name()"
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

    <ng-template #menuProfilo>
      <hlm-dropdown-menu class="w-60">
        <div hlmDropdownMenuLabel class="flex flex-col gap-0.5">
          <span class="truncate font-medium">{{ name() }}</span>
          @if (email(); as indirizzo) {
            <span class="text-muted-foreground truncate text-xs font-normal">{{ indirizzo }}</span>
          }
          @if (subtitle(); as testo) {
            <span class="text-muted-foreground truncate text-xs font-normal">{{ testo }}</span>
          }
        </div>

        <hlm-dropdown-menu-separator />

        <hlm-dropdown-menu-group>
          @for (voce of entries(); track voce.label) {
            <button hlmDropdownMenuItem type="button" (click)="voce.azione()">
              <ng-icon [name]="voce.icona" />
              {{ voce.label }}
            </button>
          }

          <button hlmDropdownMenuItem type="button" (click)="tema.toggle()">
            <ng-icon [name]="tema.resolved() === 'dark' ? 'lucideSun' : 'lucideMoon'" />
            {{ tema.resolved() === 'dark' ? 'Tema chiaro' : 'Tema scuro' }}
          </button>
        </hlm-dropdown-menu-group>

        <hlm-dropdown-menu-separator />

        <button hlmDropdownMenuItem type="button" class="text-destructive" (click)="signOut.emit()">
          <ng-icon name="lucideLogOut" />
          Esci
        </button>
      </hlm-dropdown-menu>
    </ng-template>
  `,
})
export class ProfileMenuComponent {
  protected readonly tema = inject(ThemeService);

  readonly name = input.required<string>();
  readonly email = input<string>();
  /** Context line: the role, the company, whatever distinguishes this account. */
  readonly subtitle = input<string>();
  readonly avatarUrl = input<string>();
  readonly entries = input<ProfileMenuEntry[]>([]);

  readonly signOut = output<void>();

  /** Initials, as the fallback when there is no picture. */
  protected readonly initials = computed(() => {
    const [first, second] = this.name().trim().split(/\s+/).filter(Boolean);
    if (!first) return '?';
    return (first.charAt(0) + (second?.charAt(0) ?? '')).toUpperCase();
  });
}
