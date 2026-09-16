import { _IdGenerator } from '@angular/cdk/a11y';
import { inject, Service } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HlmDialogService } from '@spartan-ng/helm/dialog';
import { ConfirmComponent, type ConfirmContext } from './confirm.component';
import { type ConfirmOptions } from './confirm.model';

/**
 * Asks for confirmation before an operation, and waits for the answer.
 *
 * ```ts
 * if (!(await this.confirm.forDeletion('the role Site manager'))) return;
 * await firstValueFrom(this.api.remove(id));
 * ```
 *
 * A promise rather than an event, because the place where you ask and the place
 * where you act are the same line of code. With a callback the consequence ends up
 * far from the question, and the "they said no" branch is the one that gets
 * forgotten.
 *
 * For short questions only — delete, suspend, overwrite. Anything with something to
 * fill in or explain deserves a page: a window covering the context is the wrong
 * place to think.
 */
@Service()
export class ConfirmService {
  private readonly dialogs = inject(HlmDialogService);
  private readonly id = inject(_IdGenerator);

  /**
   * @returns true only if the confirm button was pressed. Esc, an outside click and
   *          every other way out count as no: faced with a destructive question,
   *          silence is not consent.
   */
  async ask(options: ConfirmOptions): Promise<boolean> {
    const titleId = this.id.getId('dui-confirm-');
    const context: ConfirmContext = { ...options, titleId };

    const ref = this.dialogs.open<boolean, ConfirmContext>(ConfirmComponent, {
      context,
      // A close X would offer a third way out of a question that has two.
      showCloseButton: false,
      role: 'alertdialog',
      ariaLabelledBy: titleId,
      // An outside click does not cancel: on a destructive action that is far too
      // easy a way to make the question disappear without having read it.
      closeOnOutsidePointerEvents: false,
      // Focus lands on "Cancel" when destroying (it is the first tabbable element)
      // and on the confirmation when there is nothing to lose: in one case an
      // absent-minded Enter does no damage, in the other it saves a step.
      autoFocus: options.destructive ? 'first-tabbable' : '[data-dui-confirm]',
    });

    return (await firstValueFrom(ref.closed$)) ?? false;
  }

  /**
   * The question you almost always ask, already written.
   *
   * @param what    name of the thing, with its article: "the role Site manager".
   * @param message the consequence, when it is more than "it disappears".
   */
  forDeletion(what: string, message?: string): Promise<boolean> {
    return this.ask({
      title: `Delete ${what}?`,
      message,
      confirmLabel: 'Delete',
      destructive: true,
    });
  }
}
