import { Service, signal } from '@angular/core';
import {
  type AbstractControl,
  FormArray,
  FormControl,
  FormGroup,
  type ValidationErrors,
} from '@angular/forms';

/**
 * i18n keys for the validation messages. They are the contract with the translation
 * layer: resolving these and handing the result to
 * risolvere questi valori e passarli a `FormUtilityService.loadErrors()`.
 */
export const FORM_ERROR_KEYS: Readonly<Record<string, string>> = {
  required: 'form.required',
  minlength: 'form.minlength',
  maxlength: 'form.maxlength',
  min: 'form.min',
  max: 'form.max',
  pattern: 'form.pattern',
  passwordMismatch: 'form.passwordMismatch',
};

/**
 * I Reactive Forms usano chiavi minuscole (`minlength`), le Signal Forms camelCase
 * (`minLength`). This map folds the latter onto the former so there is one catalogue.
 */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  minLength: 'minlength',
  maxLength: 'maxlength',
};

/**
 * The parameters are renamed too: reactive forms emit `requiredLength`, signal forms
 * `minLength`/`maxLength`. The catalogue uses a single placeholder, and it is also
 * exposed here under the other name.
 */
const PARAM_ALIASES: Readonly<Record<string, string>> = {
  minLength: 'requiredLength',
  maxLength: 'requiredLength',
};

/**
 * Messaggi di fallback usati finche' l'i18n non e' agganciato.
 *
 * The names in braces are not free-form: `resolve()` literally substitutes `{key}`
 * with the parameters the Angular validator emits, so they must
 * combaciare con quelli reali (`requiredLength`, `min`, `max`, ...).
 */
export const FORM_ERROR_FALLBACK: Readonly<Record<string, string>> = {
  required: 'This field is required',
  minlength: 'At least {requiredLength} characters',
  maxlength: 'At most {requiredLength} characters',
  min: 'Il valore minimo è {min}',
  max: 'Il valore massimo è {max}',
  pattern: 'Invalid format',
  passwordMismatch: 'Passwords do not match',
};

@Service()
export class FormUtilityService {
  private readonly _errorsText = signal<Record<string, string>>({ ...FORM_ERROR_FALLBACK });

  /** Current message catalogue. A signal, so the UI realigns itself on a language change. */
  readonly errorsText = this._errorsText.asReadonly();

  /**
   * Punto d'innesto per l'i18n. Da richiamare allo start dell'applicazione e a
   * ogni cambio lingua.
   *
   * Note: it merges onto the fallback catalogue rather than replacing it. With a
   * complete catalogue the behaviour is identical; with a partial one, untranslated
   * keys keep their
   * tradotte mantengono il message italiano anziche' diventare `undefined`.
   */
  loadErrors(errors: Record<string, string>): void {
    this._errorsText.update((current) => ({ ...current, ...errors }));
  }

  /**
   * Resolves the message for an error key, substituting the placeholders with the
   * parametri del validator.
   *
   * It lives here rather than in a component because both `dui-validator-errors` and
   * `hlm-field-error`.
   */
  resolve(key: string, params?: ValidationErrors[string]): string {
    // An explicit message on the error wins over the catalogue: signal forms
    // permettono `required(campo, { message: '...' })`.
    if (params && typeof params === 'object' && 'message' in params) {
      const message = (params as { message?: unknown }).message;
      if (typeof message === 'string' && message) return message;
    }

    let text = this._errorsText()[key] ?? this._errorsText()[KEY_ALIASES[key] ?? ''];
    if (text == null) return key;
    if (params == null || typeof params !== 'object') return text;

    for (const [name, value] of Object.entries(params as Record<string, unknown>)) {
      // Only primitives reach the message: signal form error objects also carry
      // Forms portano anche riferimenti al campo, e String() su quelli solleva.
      const type = typeof value;
      if (value == null || type === 'object' || type === 'function' || type === 'symbol') {
        continue;
      }

      const replacement = String(value);
      text = text.replaceAll(`{${name}}`, replacement);

      const alias = PARAM_ALIASES[name];
      if (alias) text = text.replaceAll(`{${alias}}`, replacement);
    }
    return text;
  }

  /** Risolve tutti gli errori di un control nell'ordine in cui Angular li espone. */
  resolveAll(errors: ValidationErrors | null | undefined): string[] {
    if (!errors) return [];
    return Object.keys(errors).map((key) => this.resolve(key, errors[key]));
  }

  markFormDirty(formGroup: FormGroup): void {
    Object.keys(formGroup.controls).forEach((key) => this.markAsDirty(formGroup, key));
  }

  markArrayDirty(formArray: FormArray): void {
    formArray.controls.forEach((control) => this.markAsDirty(control, null));
  }

  markAsDirty(formElement: AbstractControl, key: string | null): void {
    const control = key == null ? formElement : formElement.get(key);
    if (control instanceof FormGroup) return this.markFormDirty(control);
    if (control instanceof FormArray) return this.markArrayDirty(control);
    if (control instanceof FormControl) return this.markControlDirty(control);
  }

  markControlDirty(formControl: FormControl): void {
    formControl.markAsDirty();
  }
}
