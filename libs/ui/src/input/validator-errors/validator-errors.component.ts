import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { type AbstractControl, type ValidationErrors } from '@angular/forms';
import { BrnField } from '@spartan-ng/brain/field';
import { classes } from '@spartan-ng/helm/utils';
import { FormUtilityService } from '../../mix/form-utility.service';

/**
 * Elenco dei messaggi di validazione di un control.
 *
 * Funziona in due modi:
 *
 * 1. **Explicit** — with `[control]` passed in. The
 *    visibility condition is `dirty && touched`, so errors do not appear before the
 *    visibility condition is `dirty && touched`.
 * 2. **Contestuale** — dentro un `hlm-field`, senza `[control]`: legge errori e
 *    stato direttamente da `BrnField`, delegando a Spartan la decisione su
 *    *quando* mostrare l'errore (`ErrorStateMatcher`).
 */
@Component({
  selector: 'dui-validator-errors',
  host: {
    role: 'alert',
    'data-slot': 'field-error',
    '[hidden]': '!messages().length',
  },
  template: `
    @if (messages().length) {
      <ul class="list-none">
        @for (message of messages(); track message) {
          <li>{{ message }}</li>
        }
      </ul>
    }
  `,
})
export class ValidatorErrorsComponent {
  private readonly formUtility = inject(FormUtilityService);
  private readonly field = inject(BrnField, { optional: true });

  readonly control = input<AbstractControl | null>(null);

  /** Bumped on every control event: AbstractControl is not reactive on its own. */
  private readonly version = signal(0);

  protected readonly messages = computed(() => this.formUtility.resolveAll(this.visibleErrors()));

  private readonly visibleErrors = computed<ValidationErrors | null>(() => {
    const control = this.control();

    if (control) {
      this.version();
      const show = control.dirty && control.touched && !!control.errors;
      return show ? control.errors : null;
    }

    if (this.field) {
      return this.field.controlState()?.spartanInvalid ? this.field.errors() : null;
    }

    return null;
  });

  constructor() {
    classes(() => 'text-destructive text-sm font-normal');

    effect((onCleanup) => {
      const control = this.control();
      if (!control) return;
      const subscription = control.events.subscribe(() => this.version.update((v) => v + 1));
      onCleanup(() => subscription.unsubscribe());
    });
  }
}
