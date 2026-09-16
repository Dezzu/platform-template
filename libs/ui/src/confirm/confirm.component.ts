import { Component, inject } from '@angular/core';
import { BrnDialogRef, injectBrnDialogContext } from '@spartan-ng/brain/dialog';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { type ConfirmOptions } from './confirm.model';

/** What the service passes in: the options plus the id of the title. */
export interface ConfirmContext extends ConfirmOptions {
  /** Id of the title, already referenced by `aria-labelledby` on the container. */
  titleId: string;
}

/**
 * The body of the confirmation dialog.
 *
 * Not used directly: `ConfirmService` opens it, and that is the only way to get the
 * answer back. It lives in its own component because the service needs something to
 * instantiate in the portal, not because it is useful anywhere else.
 *
 * Chiude passando un booleano: `BrnDialogRef.closed$` lo consegna a chi ha
 * asked. Closing from outside — Esc, or the container disappearing — passes
 * nothing, and the service reads that nothing as a refusal.
 */
@Component({
  selector: 'dui-confirm',
  imports: [HlmButtonImports],
  host: { class: 'flex flex-col gap-4' },
  template: `
    <div class="flex flex-col gap-2">
      <h2 [id]="context.titleId" class="text-base leading-none font-semibold">
        {{ context.title }}
      </h2>
      @if (context.message) {
        <p class="text-muted-foreground text-sm">{{ context.message }}</p>
      }
    </div>

    <!--
      Cancel comes first in DOM order, as the dialog convention wants: it is also the
      first tabbable element, which is how focus lands on it when the action is
      destructive.
    -->
    <div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button hlmBtn type="button" variant="outline" (click)="rispondi(false)">
        {{ context.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        hlmBtn
        type="button"
        data-dui-confirm
        [variant]="context.destructive ? 'destructive' : 'default'"
        (click)="rispondi(true)"
      >
        {{ context.confirmLabel ?? 'Conferma' }}
      </button>
    </div>
  `,
})
export class ConfirmComponent {
  private readonly ref = inject<BrnDialogRef<boolean>>(BrnDialogRef);

  protected readonly context = injectBrnDialogContext<ConfirmContext>();

  protected rispondi(risposta: boolean): void {
    this.ref.close(risposta);
  }
}
