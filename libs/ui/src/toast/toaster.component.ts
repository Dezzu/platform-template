import { Component, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircleAlert, lucideCircleCheck, lucideInfo, lucideX } from '@ng-icons/lucide';
import { HlmButtonImports } from '@spartan-ng/helm/button';

export type ToastTone = 'success' | 'error' | 'info';

/**
 * One message to show. `messageKey` is an i18n key, never a sentence.
 *
 * Declared here rather than imported from wherever the state lives, for the same
 * reason ShellNavItem is: this component may not depend on `libs/core`, and being
 * driven by inputs is what keeps it a rendering decision rather than a state one.
 */
export interface ToastMessage {
  id: number;
  tone: ToastTone;
  messageKey: string;
  params?: Record<string, unknown>;
}

const ICONS: Record<ToastTone, string> = {
  success: 'lucideCircleCheck',
  error: 'lucideCircleAlert',
  info: 'lucideInfo',
};

/**
 * Renders the transient messages it is handed.
 *
 * Mounted once, at the root, so a toast raised on one screen survives the navigation
 * it caused — "invito inviato" that vanishes because the page changed is a message
 * nobody reads.
 *
 * Translating here rather than where the toast was raised is what lets a language
 * switch re-render one that is already on screen, instead of leaving a stale sentence.
 *
 * `aria-live` differs by tone: an error interrupts (`assertive`), a confirmation waits
 * its turn (`polite`). Announcing every success over whatever the reader was hearing is
 * how a screen reader becomes unusable.
 */
@Component({
  selector: 'dui-toaster',
  imports: [NgIcon, TranslocoPipe, HlmButtonImports],
  providers: [provideIcons({ lucideCircleCheck, lucideCircleAlert, lucideInfo, lucideX })],
  template: `
    <!--
      pointer-events-none on the stack, auto on each toast: the area an expired toast
      used to cover has to stay clickable.
    -->
    <div
      class="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      @for (toast of toasts(); track toast.id) {
        <div
          class="bg-background pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-3 shadow-lg"
          [class.border-destructive]="toast.tone === 'error'"
          [attr.role]="toast.tone === 'error' ? 'alert' : 'status'"
          [attr.aria-live]="toast.tone === 'error' ? 'assertive' : 'polite'"
        >
          <ng-icon
            class="mt-0.5 shrink-0"
            [name]="icon(toast.tone)"
            [class.text-destructive]="toast.tone === 'error'"
            [class.text-green-600]="toast.tone === 'success'"
            [class.text-muted-foreground]="toast.tone === 'info'"
          />

          <p class="min-w-0 flex-1 text-sm">{{ toast.messageKey | transloco: toast.params }}</p>

          <button
            hlmBtn
            size="icon-sm"
            variant="ghost"
            type="button"
            class="-me-1 -mt-1 shrink-0"
            [attr.aria-label]="'common.close' | transloco"
            (click)="dismissed.emit(toast.id)"
          >
            <ng-icon name="lucideX" />
          </button>
        </div>
      }
    </div>
  `,
})
export class ToasterComponent {
  readonly toasts = input.required<readonly ToastMessage[]>();
  readonly dismissed = output<number>();

  protected icon(tone: ToastTone): string {
    return ICONS[tone];
  }
}
