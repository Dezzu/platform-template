import { booleanAttribute, Component, computed, input, output } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';

/**
 * Contenitore che aggiunge un pulsante "svuota" a un controllo.
 *
 * Sostituisce l'accoppiata `p-iconfield` / `p-inputicon` con `hlm-input-group`.
 * The clear control is a real `<button>`, reachable by keyboard and carrying an
 * accessible label — not a
 * `<span>` con un click listener.
 *
 * Projected content must carry `hlmInputGroupInput` (or be an
 * `hlmInputGroupTextarea`) per allinearsi al gruppo.
 */
@Component({
  selector: 'dui-input-clear',
  imports: [HlmInputGroupImports, NgIcon],
  providers: [provideIcons({ lucideX })],
  template: `
    <hlm-input-group>
      <ng-content />

      @if (showClearButton()) {
        <hlm-input-group-addon align="inline-end">
          <button
            hlmInputGroupButton
            size="icon-xs"
            [attr.aria-label]="clearLabel()"
            (click)="clear.emit()"
          >
            <ng-icon name="lucideX" />
          </button>
        </hlm-input-group-addon>
      }

      <ng-content select="[duiInputSuffix]" />
    </hlm-input-group>
  `,
})
export class InputClearComponent {
  readonly showClear = input(true, { transform: booleanAttribute });
  readonly value = input<unknown>();
  readonly clearLabel = input('Clear field');

  readonly clear = output<void>();

  protected readonly showClearButton = computed(() => {
    if (!this.showClear()) return false;
    const value = this.value();
    return value !== undefined && value !== null && value !== '';
  });
}
