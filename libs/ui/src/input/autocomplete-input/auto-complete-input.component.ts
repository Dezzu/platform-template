import { Component, input, output } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { HlmAutocompleteImports } from '@spartan-ng/helm/autocomplete';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { TranslocoPipe } from '@jsverse/transloco';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/**
 * A text field with suggestions.
 *
 * Producing the suggestions stays the caller's responsibility: `completeMethod` emits
 * the typed text and the component renders only what it is handed back in
 * `suggestions`. Debouncing, cancelling and caching belong to whoever owns the data
 * source, which is the only place that knows what any of them should cost.
 *
 * `completeMethod` emits a plain string rather than an event object, so a handler
 * receives the query directly.
 */
@Component({
  selector: 'dui-autocomplete-input',
  imports: [HlmFieldImports, HlmAutocompleteImports, ValidatorErrorsComponent, TranslocoPipe],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: AutoCompleteInputComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <!--
        "block w-full" on the element: the primitive declares no display, so it would
        stay inline and the field inside would size itself against a container that
        shrinks to its text.
      -->
      <hlm-autocomplete
        class="block w-full"
        [value]="value()"
        [itemToString]="itemToString"
        [disabled]="disabled()"
        (valueChange)="onValueChange($event)"
        (searchChange)="completeMethod.emit($event)"
      >
        <hlm-autocomplete-input
          [inputId]="controlId()"
          [placeholder]="placeholder()"
          [showClear]="showClear()"
        />

        <hlm-autocomplete-content *hlmAutocompletePortal>
          <div hlmAutocompleteList>
            @for (suggestion of suggestions(); track suggestion) {
              <hlm-autocomplete-item [value]="suggestion">
                {{ itemToString(suggestion) }}
              </hlm-autocomplete-item>
            } @empty {
              @if (showEmptyMessage()) {
                <div hlmAutocompleteEmpty>{{ emptyMessage() | transloco }}</div>
              }
            }
          </div>
        </hlm-autocomplete-content>
      </hlm-autocomplete>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class AutoCompleteInputComponent extends DuiInputBase<unknown> {
  readonly suggestions = input<unknown[]>([]);
  readonly optionLabel = input<string>();
  readonly showEmptyMessage = input(true);
  /** i18n key, not a sentence — it is piped through transloco in the template. */
  readonly emptyMessage = input('common.empty');

  /** The list opens as you type; there is no separate trigger button. */
  readonly dropdown = input(true);

  readonly onSelect = output<unknown>();
  readonly onClear = output<void>();
  readonly completeMethod = output<string>();

  protected readonly itemToString = (item: unknown): string => {
    const key = this.optionLabel();
    if (!key || item == null || typeof item !== 'object') return String(item ?? '');
    return String((item as Record<string, unknown>)[key] ?? '');
  };

  protected onValueChange(value: unknown): void {
    this.updateValue(value);
    if (value == null || value === '') {
      this.onClear.emit();
    } else {
      this.onSelect.emit(value);
    }
  }
}
