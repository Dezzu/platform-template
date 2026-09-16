import { Component, computed, input, signal } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideChevronDown, lucideChevronUp, lucideX } from '@ng-icons/lucide';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

export type NumberInputMode = 'decimal' | 'currency';

const LOCALE = 'it-IT';

/** The locale's actual separators, read from Intl rather than assumed. */
function localeSeparators(): { group: string; decimal: string } {
  const parts = new Intl.NumberFormat(LOCALE).formatToParts(12345.6);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? '.',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? ',',
  };
}

/**
 * Campo numerico.
 *
 * `p-inputNumber` non ha equivalente in Spartan, quindi e' ricostruito su un input
 * plus `Intl.NumberFormat`. The field shows the formatted value at rest and switches
 * to the raw form on focus, so it can be typed into without
 * combattere con i separatori di migliaia.
 */
@Component({
  selector: 'dui-number-input',
  imports: [HlmFieldImports, HlmInputGroupImports, ValidatorErrorsComponent, NgIcon, TranslocoPipe],
  providers: [
    provideIcons({ lucideChevronUp, lucideChevronDown, lucideX }),
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: NumberInputComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <hlm-input-group>
        @if (prefix()) {
          <hlm-input-group-addon>
            <span hlmInputGroupText>{{ prefix() }}</span>
          </hlm-input-group-addon>
        }

        <input
          hlmInputGroupInput
          type="text"
          inputmode="decimal"
          role="spinbutton"
          [id]="controlId()"
          [class]="inputClass()"
          [placeholder]="placeholder()"
          [value]="displayValue()"
          [disabled]="disabled()"
          [attr.aria-valuemin]="min()"
          [attr.aria-valuemax]="max()"
          [attr.aria-valuenow]="value()"
          (focus)="onFocus()"
          (input)="onInput($any($event.target).value)"
          (blur)="onBlur()"
          (keydown.arrowup)="$event.preventDefault(); step(1)"
          (keydown.arrowdown)="$event.preventDefault(); step(-1)"
        />

        @if (suffix()) {
          <hlm-input-group-addon align="inline-end">
            <span hlmInputGroupText>{{ suffix() }}</span>
          </hlm-input-group-addon>
        }

        @if (showClearButton()) {
          <hlm-input-group-addon align="inline-end">
            <button
              hlmInputGroupButton
              size="icon-xs"
              [attr.aria-label]="'common.clearField' | transloco"
              [disabled]="disabled()"
              (click)="handleClear()"
            >
              <ng-icon name="lucideX" />
            </button>
          </hlm-input-group-addon>
        }

        @if (showButtons()) {
          <hlm-input-group-addon align="inline-end">
            <div class="flex flex-col">
              <button
                hlmInputGroupButton
                size="icon-xs"
                class="h-3.5"
                aria-label="Incrementa"
                [disabled]="disabled() || atMax()"
                (click)="step(1)"
              >
                <ng-icon name="lucideChevronUp" />
              </button>
              <button
                hlmInputGroupButton
                size="icon-xs"
                class="h-3.5"
                aria-label="Decrementa"
                [disabled]="disabled() || atMin()"
                (click)="step(-1)"
              >
                <ng-icon name="lucideChevronDown" />
              </button>
            </div>
          </hlm-input-group-addon>
        }
      </hlm-input-group>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class NumberInputComponent extends DuiInputBase<number> {
  readonly prefix = input<string>();
  readonly suffix = input<string>();
  readonly showButtons = input(true);
  readonly min = input<number>();
  readonly max = input<number>();
  readonly minFractionDigits = input(0);
  readonly maxFractionDigits = input(5);
  readonly stepValue = input(1, { alias: 'step' });
  readonly currency = input<string>('EUR');
  readonly mode = input<NumberInputMode>('decimal');
  readonly useGrouping = input(false);

  /** Text typed while the field has focus; `null` when the field is at rest. */
  private readonly draft = signal<string | null>(null);

  private readonly formatter = computed(
    () =>
      new Intl.NumberFormat(LOCALE, {
        style: this.mode() === 'currency' ? 'currency' : 'decimal',
        currency: this.currency(),
        minimumFractionDigits: this.minFractionDigits(),
        maximumFractionDigits: this.maxFractionDigits(),
        useGrouping: this.useGrouping(),
      }),
  );

  protected readonly displayValue = computed(() => {
    const draft = this.draft();
    if (draft !== null) return draft;

    const value = this.value();
    if (value == null || Number.isNaN(value)) return '';
    return this.formatter().format(value);
  });

  protected readonly showClearButton = computed(() => {
    const value = this.value();
    return this.showClear() && value != null && !Number.isNaN(value);
  });

  protected readonly atMin = computed(() => {
    const min = this.min();
    const value = this.value();
    return min != null && value != null && value <= min;
  });

  protected readonly atMax = computed(() => {
    const max = this.max();
    const value = this.value();
    return max != null && value != null && value >= max;
  });

  protected onFocus(): void {
    const value = this.value();
    this.draft.set(value == null ? '' : this.toRawString(value));
  }

  protected onInput(raw: string): void {
    this.draft.set(raw);
    const parsed = this.parse(raw);
    // No clamping while typing: it would block legitimate intermediate states such
    // as "1" on the way to "15" when the minimum is 10.
    this.updateValue(parsed);
  }

  protected onBlur(): void {
    const parsed = this.parse(this.draft() ?? '');
    this.draft.set(null);
    this.updateValue(parsed == null ? null : this.clamp(this.round(parsed)));
    this.markAsTouched();
  }

  protected step(direction: 1 | -1): void {
    const current = this.value() ?? 0;
    const next = this.clamp(this.round(current + direction * this.stepValue()));
    this.draft.set(null);
    this.updateValue(next);
    this.markAsTouched();
  }

  /** Forma editabile: separatore decimale del locale, nessun raggruppamento. */
  private toRawString(value: number): string {
    const { decimal } = localeSeparators();
    return String(value).replace('.', decimal);
  }

  private parse(raw: string): number | null {
    const { group, decimal } = localeSeparators();
    const cleaned = raw
      .split(group)
      .join('')
      .replace(decimal, '.')
      // Strip currency symbols, prefixes, suffixes and spaces: the number remains.
      .replace(/[^\d.-]/g, '');

    if (cleaned === '' || cleaned === '-' || cleaned === '.' || cleaned === '-.') return null;

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private round(value: number): number {
    const factor = 10 ** this.maxFractionDigits();
    return Math.round(value * factor) / factor;
  }

  private clamp(value: number): number {
    const min = this.min();
    const max = this.max();
    if (min != null && value < min) return min;
    if (max != null && value > max) return max;
    return value;
  }
}
