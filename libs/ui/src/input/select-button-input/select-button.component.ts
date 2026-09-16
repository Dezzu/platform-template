import { Component, input } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmToggleGroupImports } from '@spartan-ng/helm/toggle-group';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/**
 * Gruppo di bottoni a selezione singola o multipla.
 *
 * Mappatura diretta di `p-selectButton` su `hlm-toggle-group`. A differenza di
 * The group exposes the correct ARIA roles, and arrow-key navigation comes from the
 * Spartan brain layer.
 */
@Component({
  selector: 'dui-button-select-input',
  imports: [HlmFieldImports, HlmToggleGroupImports, ValidatorErrorsComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: SelectButtonComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <!--
          Niente [for]: un toggle group e' un contenitore, non un elemento
          etichettabile. L'associazione corretta passa da aria-labelledby.
        -->
        <label hlmFieldLabel [id]="labelId">{{ label() }}</label>
      }

      <hlm-toggle-group
        role="group"
        [id]="controlId()"
        [attr.aria-labelledby]="label() ? labelId : null"
        [class]="inputClass()"
        [type]="multiple() ? 'multiple' : 'single'"
        [value]="$any(value())"
        [nullable]="nullable()"
        [disabled]="disabled()"
        (valueChange)="updateValue($any($event))"
      >
        @for (option of options(); track optionValueOf(option)) {
          <button hlmToggleGroupItem [value]="optionValueOf(option)" [disabled]="disabled()">
            {{ optionLabelOf(option) }}
          </button>
        }
      </hlm-toggle-group>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class SelectButtonComponent extends DuiInputBase<unknown> {
  protected readonly labelId = `${this.uuid}-label`;

  readonly options = input<unknown[]>([]);
  readonly optionLabel = input<string>();
  readonly optionValue = input<string>();
  readonly multiple = input(false);

  /** Se `true` un secondo click sull'opzione attiva la deseleziona. */
  readonly nullable = input(true);

  protected optionValueOf(option: unknown): unknown {
    const key = this.optionValue();
    if (!key || option == null || typeof option !== 'object') return option;
    return (option as Record<string, unknown>)[key];
  }

  protected optionLabelOf(option: unknown): string {
    const key = this.optionLabel();
    if (!key || option == null || typeof option !== 'object') return String(option ?? '');
    return String((option as Record<string, unknown>)[key] ?? '');
  }
}
