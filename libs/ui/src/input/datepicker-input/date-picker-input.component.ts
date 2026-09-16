import { Component, computed, input } from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideX } from '@ng-icons/lucide';
import { HlmDatePickerImports } from '@spartan-ng/helm/date-picker';
import { HlmFieldImports } from '@spartan-ng/helm/field';
import { HlmInputGroupImports } from '@spartan-ng/helm/input-group';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { hlm } from '@spartan-ng/helm/utils';
import { DuiInputBase } from '../dui-input-base';
import { ValidatorErrorsComponent } from '../validator-errors/validator-errors.component';

/** Converts a Date into the `HH:mm` form `<input type="time">` expects. */
const toTimeValue = (date: Date | null | undefined): string => {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

@Component({
  selector: 'dui-datepicker-input',
  imports: [
    HlmFieldImports,
    HlmInputGroupImports,
    HlmDatePickerImports,
    HlmInputImports,
    ValidatorErrorsComponent,
    NgIcon,
    TranslocoPipe,
  ],
  providers: [
    provideIcons({ lucideX }),
    {
      provide: NG_VALUE_ACCESSOR,
      multi: true,
      useExisting: DatePickerInputComponent,
    },
  ],
  host: { class: 'block' },
  template: `
    <hlm-field>
      @if (label()) {
        <label hlmFieldLabel [for]="controlId()">{{ label() }}</label>
      }

      <!--
        Same trap as the select: widening the wrapper and the trigger is not enough.
        hlm-date-picker sits between them and, as a flex child, is sized to its
        content — which reduces the trigger's "w-full" to nothing.
        "flex-1 min-w-0" su di lui, e la X resta attaccata al bordo destro di un
        so the field now fills the cell hosting it.
      -->
      <div class="relative flex w-full items-center gap-1">
        @if (timeOnly()) {
          <!--
            Spartan has no time picker — brain/date-time only provides date adapters.
            The native control covers the case and is already accessible and localized.
          -->
          <input
            hlmInput
            class="min-w-0 flex-1"
            type="time"
            [id]="controlId()"
            [class]="timeClass()"
            [value]="timeValue()"
            [disabled]="disabled()"
            (input)="updateTime($any($event.target).value)"
            (blur)="markAsTouched()"
          />
        } @else {
          <hlm-date-picker
            class="min-w-0 flex-1"
            [date]="dateValue()"
            [minDate]="minDate()"
            [maxDate]="maxDate()"
            [disabled]="disabled()"
            (dateChange)="updateValue($event)"
          >
            <hlm-date-picker-trigger [buttonId]="controlId()" [class]="triggerClass()">
              {{ placeholder() || 'Seleziona una data' }}
            </hlm-date-picker-trigger>
          </hlm-date-picker>
        }

        @if (showClearButton()) {
          <button
            hlmInputGroupButton
            size="icon-xs"
            class="text-muted-foreground absolute end-1 top-1/2 -translate-y-1/2"
            [attr.aria-label]="'common.clearDate' | transloco"
            [disabled]="disabled()"
            (click)="handleClear()"
          >
            <ng-icon name="lucideX" />
          </button>
        }
      </div>

      <dui-validator-errors />
    </hlm-field>
  `,
})
export class DatePickerInputComponent extends DuiInputBase<Date> {
  readonly timeOnly = input(false);
  readonly minDate = input<Date>();
  readonly maxDate = input<Date>();

  protected readonly dateValue = computed(() => this.value() ?? undefined);
  protected readonly timeValue = computed(() => toTimeValue(this.value()));

  protected readonly showClearButton = computed(() => this.showClear() && this.value() != null);

  /** Room on the right for the overlaid clear button. */
  /** Full width like the other fields: the trigger is a button and would otherwise shrink to its text. */
  protected readonly triggerClass = computed(() =>
    hlm('w-full', this.inputClass(), this.showClearButton() ? 'pe-9' : ''),
  );

  /** Room for the native clock icon plus the overlaid clear button. */
  protected readonly timeClass = computed(() =>
    hlm(this.inputClass(), this.showClearButton() ? 'pe-11' : ''),
  );

  protected updateTime(raw: string): void {
    if (!raw) {
      this.handleClear();
      return;
    }
    const [rawHours, rawMinutes] = raw.split(':');
    const hours = Number(rawHours);
    const minutes = Number(rawMinutes ?? '0');
    // A partial value such as "12" would otherwise reach setHours(12, undefined) and
    // produce an Invalid Date, which then silently clears the field.
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return;

    // Start from the current value so editing only the time does not lose the date.
    const base = this.value() instanceof Date ? new Date(this.value() as Date) : new Date();
    base.setHours(hours, minutes, 0, 0);
    this.updateValue(base);
  }
}
