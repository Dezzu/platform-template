import { Component, computed, inject, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEye, lucideEyeOff, lucideX } from '@ng-icons/lucide';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/**
 * Password field with a reveal toggle.
 *
 * The toggle is a real button carrying `aria-pressed` and a label that changes with
 * its state, so a screen reader announces whether the password is currently visible.
 *
 * No strength meter: it belongs in its own component if it is ever needed, and a weak
 * one trains people to game the indicator rather than choose a better password.
 */
@Component({
  selector: 'dui-password-input',
  imports: [HlmFieldImports, HlmInputGroupImports, ValidatorErrorsComponent, NgIcon, TranslocoPipe],
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
          [autocomplete]="autocompleteHint()"
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
                [attr.aria-label]="'common.clearField' | transloco"
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
  private readonly transloco = inject(TranslocoService);

  readonly toggleMask = input(true);

  /**
   * Explicit rather than derived from the base `autocomplete` on/off input: password
   * managers behave very differently for 'current-password' and 'new-password', and
   * getting it wrong on a sign-up form makes them offer the existing password instead
   * of generating one.
   */
  readonly autocompleteHint = input<'current-password' | 'new-password' | 'off'>(
    'current-password',
  );

  protected readonly revealed = signal(false);

  protected readonly showClearButton = computed(() => {
    const value = this.value();
    return this.showClear() && value !== undefined && value !== null && value !== '';
  });

  protected readonly toggleLabel = computed(() =>
    this.transloco.translate(this.revealed() ? 'common.hidePassword' : 'common.showPassword'),
  );

  protected toggleReveal(): void {
    this.revealed.update((revealed) => !revealed);
  }
}
