import { Component, computed, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { TranslocoService } from '@jsverse/transloco';
import { ToastService } from '@app/core';
import { FORM_ERROR_KEYS, FormUtilityService, ThemeService } from '@app/ui/mix';
import { ToasterComponent, type ToastMessage } from '@app/ui/toast';

/**
 * The root holds the outlet and the toaster: the frame lives in ShellPage, behind the
 * auth guard, so the sign-in screen is not wrapped in a sidebar it has no use for.
 *
 * The toaster is here rather than in the shell because a message must outlive the
 * navigation that caused it, and because the screens outside the shell — signing in,
 * resetting a password — have outcomes worth reporting too.
 *
 * ThemeService is instantiated here for the same reason, and it is not decoration:
 * nothing else constructs it except the profile menu, which lives inside the shell —
 * so signing in, resetting a password and the maintenance notice all rendered in the
 * light theme however the preference was set. Found by opening the page.
 *
 * The validation catalogue is loaded here too. `FORM_ERROR_KEYS` has always declared
 * the i18n key for each validator, and `form.required` and friends have always existed
 * in both locales — but nothing ever called `loadErrors()`, so every form fell back to
 * the hard-coded English strings in the service. Also found by opening the page: an
 * Italian form answering "Invalid format".
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToasterComponent],
  templateUrl: './app.html',
  host: { class: 'block min-h-screen' },
})
export class App {
  private readonly toastService = inject(ToastService);
  /** Injected for its constructor: it is what toggles `.dark` on the document. */
  private readonly theme = inject(ThemeService);
  private readonly forms = inject(FormUtilityService);
  private readonly transloco = inject(TranslocoService);

  /**
   * `langChanges$` alone misses the first load — the catalogue arrives through
   * `events$` — so both are merged, the same pattern every page here uses.
   */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  constructor() {
    effect(() => {
      this.translations();
      this.forms.loadErrors(
        Object.fromEntries(
          Object.entries(FORM_ERROR_KEYS).map(([error, key]) => [
            error,
            this.transloco.translate(key),
          ]),
        ),
      );
    });
  }

  /** Mapped, not passed through: `libs/ui` knows nothing of `libs/core`'s types. */
  protected readonly toasts = computed<ToastMessage[]>(() =>
    this.toastService.toasts().map((toast) => ({
      id: toast.id,
      tone: toast.tone,
      messageKey: toast.messageKey,
      ...(toast.params ? { params: toast.params } : {}),
    })),
  );

  protected dismiss(id: number): void {
    this.toastService.dismiss(id);
  }
}
