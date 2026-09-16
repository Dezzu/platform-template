import { Component, input } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmTextareaImports } from '@spartan-ng/helm/textarea';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/**
 * Area di testo multiriga.
 *
 * Wraps a multi-line field in the same field/label/error structure as the others,
 * senza label ne' gestione errori. Qui segue lo stesso contratto degli altri
 * `dui-*`, cosi' i form restano omogenei.
 */
@Component({
  selector: 'dui-textarea-input',
  imports: [HlmFieldImports, HlmTextareaImports, ValidatorErrorsComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: TextareaInputComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <textarea
        hlmTextarea
        [id]="controlId()"
        [class]="inputClass()"
        [rows]="rows()"
        [placeholder]="placeholder()"
        [attr.maxlength]="maxlength()"
        [value]="value() ?? ''"
        [disabled]="disabled()"
        (input)="updateValue($any($event.target).value)"
        (blur)="markAsTouched()"
      ></textarea>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class TextareaInputComponent extends DuiInputBase<string | null | undefined> {
  readonly rows = input(3);
  readonly maxlength = input<number>();
}
