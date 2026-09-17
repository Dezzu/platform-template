import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastService } from '@app/core';
import { ToasterComponent, type ToastMessage } from '@app/ui/toast';

/**
 * The root holds the outlet and the toaster: the frame lives in ShellPage, behind the
 * auth guard, so the sign-in screen is not wrapped in a sidebar it has no use for.
 *
 * The toaster is here rather than in the shell because a message must outlive the
 * navigation that caused it, and because the screens outside the shell — signing in,
 * resetting a password — have outcomes worth reporting too.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ToasterComponent],
  templateUrl: './app.html',
  host: { class: 'block min-h-screen' },
})
export class App {
  private readonly toastService = inject(ToastService);

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
