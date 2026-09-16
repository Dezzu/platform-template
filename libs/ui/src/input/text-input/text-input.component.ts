import { Component, computed, contentChild, input } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon } from '@ng-icons/core';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { DuiInputBase } from '../dui-input-base';
import { DuiInputIcon } from '../dui-input-icon.directive';
import { InputClearComponent } from '../input-clear/input-clear.component';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/**
 * Campo di testo.
 *
 * The `icon` input takes an ng-icon name (e.g. `lucideSearch`). Icons are not global:
 * the component using `dui-text-input` must declare them with
 * `provideIcons({ lucideSearch })`. In alternativa si puo' proiettare markup
 * arbitrario marcandolo con `duiInputIcon`.
 */
@Component({
  selector: 'dui-text-input',
  imports: [
    HlmFieldImports,
    HlmInputGroupImports,
    InputClearComponent,
    ValidatorErrorsComponent,
    NgIcon,
  ],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: TextInputComponent,
    },
  ],
  host: { class: 'block' },
  styles: `
    /*
      With type="search" WebKit draws its own clear icon, which would sit
      sommerebbe a quella di dui-input-clear: due X nello stesso campo.
    */
    input::-webkit-search-cancel-button,
    input::-webkit-search-decoration,
    input::-webkit-search-results-button,
    input::-webkit-search-results-decoration {
      appearance: none;
      display: none;
    }
  `,
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <dui-input-clear [showClear]="showClear()" [value]="value()" (clear)="handleClear()">
        @if (showAddon()) {
          <hlm-input-group-addon>
            @if (icon(); as iconName) {
              <ng-icon [name]="iconName" />
            }
            <ng-content select="[duiInputIcon]" />
          </hlm-input-group-addon>
        }

        <input
          hlmInputGroupInput
          [id]="controlId()"
          [class]="inputClass()"
          [type]="type()"
          [placeholder]="placeholder()"
          [autocomplete]="autocomplete()"
          [value]="value() ?? ''"
          [disabled]="disabled()"
          (input)="updateValue($any($event.target).value)"
          (blur)="markAsTouched()"
        />
      </dui-input-clear>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class TextInputComponent extends DuiInputBase<string | null | undefined> {
  readonly icon = input<string>();
  readonly type = input<'text' | 'email' | 'tel' | 'url' | 'search'>('text');

  private readonly projectedIcon = contentChild(DuiInputIcon);

  protected readonly showAddon = computed(() => !!this.icon() || !!this.projectedIcon());
}
