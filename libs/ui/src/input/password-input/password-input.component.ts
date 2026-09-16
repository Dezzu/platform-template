import { Component, computed, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEye, lucideEyeOff, lucideX } from '@ng-icons/lucide';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/**
 * Campo password con toggle di visibilita'.
 *
 * The reveal toggle is an explicit button carrying `aria-pressed` and a label that
 * changes with its state.
 *
 * Note: there is no strength meter here, and one was deliberately not
 * e' stato riprodotto. Se serviva, va reintrodotto come componente a parte.
 */
@Component({
  selector: 'dui-password-input',
  imports: [HlmFieldImports, HlmInputGroupImports, ValidatorErrorsComponent, NgIcon],
  providers: [
    provideIcons({ lucideEye, lucideEyeOff, lucideX }),
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: PasswordInputComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <hlm-input-group>
        <input
          hlmInputGroupInput
          [id]="controlId()"
          [class]="inputClass()"
          [type]="revealed() ? 'text' : 'password'"
          [placeholder]="placeholder()"
          [autocomplete]="autocomplete() === 'on' ? 'current-password' : 'off'"
          [value]="value() ?? ''"
          [disabled]="disabled()"
          (input)="updateValue($any($event.target).value)"
          (blur)="markAsTouched()"
        />

        @if (showClearButton() || toggleMask()) {
          <hlm-input-group-addon align="inline-end">
            @if (showClearButton()) {
              <button
                hlmInputGroupButton
                size="icon-xs"
                aria-label="Svuota il campo"
                [disabled]="disabled()"
                (click)="handleClear()"
              >
                <ng-icon name="lucideX" />
              </button>
            }
            @if (toggleMask()) {
              <button
                hlmInputGroupButton
                size="icon-xs"
                [attr.aria-label]="toggleLabel()"
                [attr.aria-pressed]="revealed()"
                [disabled]="disabled()"
                (click)="toggleReveal()"
              >
                <ng-icon [name]="revealed() ? 'lucideEyeOff' : 'lucideEye'" />
              </button>
            }
          </hlm-input-group-addon>
        }
      </hlm-input-group>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class PasswordInputComponent extends DuiInputBase<string | null | undefined> {
  readonly toggleMask = input(true);

  protected readonly revealed = signal(false);

  protected readonly showClearButton = computed(() => {
    const value = this.value();
    return this.showClear() && value !== undefined && value !== null && value !== '';
  });

  protected readonly toggleLabel = computed(() =>
    this.revealed() ? 'Hide password' : 'Show password',
  );

  protected toggleReveal(): void {
    this.revealed.update((revealed) => !revealed);
  }
}
