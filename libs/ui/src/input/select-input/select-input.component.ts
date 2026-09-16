import { Component, computed, effect, input, isDevMode } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmSelectImports } from '@spartan-ng/helm/select';
import { HlmSpinnerImports } from '@spartan-ng/helm/spinner';
import { hlm } from '@spartan-ng/helm/utils';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

export type SelectOption = {
  label: string;
  value: unknown;
  data?: unknown;
};

/**
 * Select singola o multipla.
 *
 * Renders options as text. Custom item templates are not implemented; when they are
 * needed they should be designed as content projection rather than a bag of template
 * inputs.
 *
 * The options are repeated across the two branches rather than extracted into an
 * `ng-template`
 * condiviso: `ngTemplateOutlet` istanzia col context di *dichiarazione*, quindi
 * because `hlm-select-item` would not find the select's `BrnSelectBaseToken`.
 *
 * `enableFilter` is not implemented yet: filtering requires `hlm-combobox`,
 * che e' un percorso di rendering diverso da `hlm-select`.
 */
@Component({
  selector: 'dui-select-input',
  imports: [
    HlmFieldImports,
    HlmInputGroupImports,
    HlmSelectImports,
    HlmSpinnerImports,
    ValidatorErrorsComponent,
    NgIcon,
  ],
  providers: [
    provideIcons({ lucideX }),
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: SelectInputComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <!--
        The clear button cannot live inside the trigger's <button> (nested buttons are
        not valid HTML): it is an absolutely positioned sibling overlaid on top, and
        the trigger reserves room for it with padding.

        Three elements to widen, not two: the wrapper, the select element and the
        trigger. The middle one is easy to forget — it declares no display, so as a
        flex child it is sized to its content, and a "w-full" on the trigger ends up
        meaning 100% of an already narrow box. Hence "flex-1 min-w-0" there: it grows
        to fill the row, and "min-w-0" removes the minimum width
        automatica che altrimenti impedirebbe al testo lungo di troncarsi.

        An inline "fit-content" on the wrapper would keep the clear button attached to
        the trigger, but it also keeps the field narrow around its content: in a grid,
        a select next to a text field ends up shorter than it, without anyone having
        chosen that.
      -->
      <div class="relative flex w-full items-center gap-1">
        @if (multiple()) {
          <hlm-select-multiple
            class="min-w-0 flex-1"
            [value]="valuesArray()"
            [itemToString]="itemToString"
            [disabled]="disabled()"
            (valueChange)="updateValue($any($event))"
          >
            <hlm-select-trigger [buttonId]="controlId()" [class]="triggerClass()">
              <hlm-select-value [placeholder]="placeholder()" />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (option of options(); track optionValueOf(option)) {
                <hlm-select-item [value]="optionValueOf(option)">
                  {{ optionLabelOf(option) }}
                </hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select-multiple>
        } @else {
          <hlm-select
            class="min-w-0 flex-1"
            [value]="value()"
            [itemToString]="itemToString"
            [disabled]="disabled()"
            (valueChange)="updateValue($any($event))"
          >
            <hlm-select-trigger [buttonId]="controlId()" [class]="triggerClass()">
              <hlm-select-value [placeholder]="placeholder()" />
            </hlm-select-trigger>
            <hlm-select-content *hlmSelectPortal>
              @for (option of options(); track optionValueOf(option)) {
                <hlm-select-item [value]="optionValueOf(option)">
                  {{ optionLabelOf(option) }}
                </hlm-select-item>
              }
            </hlm-select-content>
          </hlm-select>
        }

        @if (showClearButton()) {
          <button
            hlmInputGroupButton
            size="icon-xs"
            class="text-muted-foreground absolute end-1 top-1/2 -translate-y-1/2"
            aria-label="Svuota la selezione"
            [disabled]="disabled()"
            (click)="handleClear()"
          >
            <ng-icon name="lucideX" />
          </button>
        }

        @if (loading()) {
          <hlm-spinner class="size-4" aria-label="Caricamento in corso" />
        }
      </div>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class SelectInputComponent extends DuiInputBase<unknown> {
  readonly options = input<SelectOption[]>([]);
  readonly optionLabel = input('label');
  readonly optionValue = input('value');
  readonly multiple = input(false);

  /** Not implemented yet: requires the combobox path. */
  readonly enableFilter = input(false);
  readonly filterBy = input('');

  constructor() {
    super();
    // Meglio un avviso rumoroso che un input ignorato in silenzio.
    effect(() => {
      if (isDevMode() && this.enableFilter()) {
        console.warn(
          '[dui-select-input] enableFilter is not supported yet: the base select does not filter. It requires the hlm-combobox path.',
        );
      }
    });
  }

  protected optionValueOf(option: SelectOption): unknown {
    return (option as unknown as Record<string, unknown>)[this.optionValue()];
  }

  protected optionLabelOf(option: SelectOption): string {
    return String((option as unknown as Record<string, unknown>)[this.optionLabel()] ?? '');
  }

  /** Multiple mode works on arrays: normalise whatever the form hands over. */
  protected readonly valuesArray = computed(() => {
    const value = this.value();
    if (value == null) return [];
    return Array.isArray(value) ? value : [value];
  });

  /** Room on the right for the overlaid clear button, which would otherwise cover the text. */
  /** `w-full` beats the primitive's `w-fit`: `hlm` resolves the conflict in favour of the last one. */
  protected readonly triggerClass = computed(() =>
    hlm('w-full', this.inputClass(), this.showClearButton() ? 'pe-9' : ''),
  );

  protected readonly showClearButton = computed(() => {
    if (!this.showClear()) return false;
    const value = this.value();
    if (value == null || value === '') return false;
    return Array.isArray(value) ? value.length > 0 : true;
  });

  /**
   * Turns the selected value into its label for the trigger.
   *
   * In multiple mode Spartan passes the whole array here, not the individual items:
   * without the dedicated branch the trigger would show raw comma-joined values.
   */
  protected readonly itemToString = (value: unknown): string => {
    if (Array.isArray(value)) {
      return value.map((item) => this.labelOfValue(item)).join(', ');
    }
    return this.labelOfValue(value);
  };

  private labelOfValue(value: unknown): string {
    const match = this.options().find((option) => this.optionValueOf(option) === value);
    return match ? this.optionLabelOf(match) : String(value ?? '');
  }
}
