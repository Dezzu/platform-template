import { _IdGenerator } from '@angular/cdk/a11y';
import { booleanAttribute, Directive, inject, input, signal } from '@angular/core';
import { type ControlValueAccessor } from '@angular/forms';
import type { ChangeFn, TouchFn } from '@spartan-ng/brain/forms';

export type InputLabelPosition = 'in' | 'on' | 'over';
export type AutoCompleteActivation = 'on' | 'off';

/**
 * Base comune dei componenti `dui-*`.
 *
 * Sostituisce la vecchia `InputBase`. Differenze principali:
 *
 * - Nessun `@Input()`/`AfterViewInit`: solo `input()` e signal.
 * - Nessun ref a `NgControl`. Lo stato di validita' lo espone `BrnFieldControl`
 *   which covers both reactive forms and signal forms; only the
 *   contratto `ControlValueAccessor`.
 * - No `uuid` dependency: ids come from the CDK generator.
 *
 * `ControlValueAccessor` contract lives here.
 */
@Directive()
export abstract class DuiInputBase<T> implements ControlValueAccessor {
  /** Stable id, used to pair label and control when `labelFor` is not supplied. */
  readonly uuid = inject(_IdGenerator).getId('dui-input-');

  readonly label = input<string>();
  readonly labelPosition = input<InputLabelPosition>('on');
  readonly labelFor = input<string>();
  readonly inputId = input<string>();
  readonly placeholder = input<string>('');
  readonly inputClass = input<string>('');
  readonly autocomplete = input<AutoCompleteActivation>('off');
  readonly loading = input(false, { transform: booleanAttribute });
  readonly showClear = input(true, { transform: booleanAttribute });

  /** Id effettivo del controllo: `labelFor` se fornito, altrimenti quello generato. */
  protected readonly controlId = () => this.labelFor() ?? this.uuid;

  readonly value = signal<T | null | undefined>(undefined);
  readonly disabled = signal(false);

  private onChange: ChangeFn<T | null | undefined> = () => {};
  private onTouch: TouchFn = () => {};

  writeValue(value: T | null | undefined): void {
    this.value.set(value);
  }

  registerOnChange(fn: ChangeFn<T | null | undefined>): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: TouchFn): void {
    this.onTouch = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  /** Updates the value and notifies the form. */
  updateValue(value: T | null | undefined): void {
    this.value.set(value);
    this.markAsTouched();
    this.onChange(value);
  }

  markAsTouched(): void {
    this.onTouch();
  }

  /**
   * Svuota il campo.
   *
   * Emits `null` rather than `undefined` on purpose: `undefined` disappears from a
   * payload once it goes through `JSON.stringify`, so the server would never learn
   * that the field was
   * semantica: `undefined` sparirebbe dai payload serializzati con `JSON.stringify`.
   */
  handleClear(): void {
    this.updateValue(null);
  }
}
