import { Component, computed, input, output, signal } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';

/**
 * One category as the banner needs it. Declared here rather than imported from
 * `@app/contracts` so the component stays presentational — and so a caller can offer a
 * different set without this file knowing what a "category" means in their product.
 */
export interface ConsentChoice {
  id: string;
  labelKey: string;
  descriptionKey: string;
  required: boolean;
  granted: boolean;
}

/**
 * The cookie banner: three buttons and a drawer, and the order of the buttons is the
 * whole design.
 *
 * **Refusing is exactly as cheap as accepting.** "Reject everything" sits next to
 * "accept everything", same size, same number of clicks — a banner where refusing takes
 * an extra screen is the dark pattern the regulators actually went after, and it is one
 * CSS class away at all times.
 *
 * **Nothing is pre-ticked.** The optional switches start off; the only ones on are the
 * ones the product cannot run without, and those are shown disabled rather than hidden,
 * because "you cannot turn this off" is information and a category the reader never
 * sees reads as one somebody is hiding.
 *
 * Presentational: it renders the choices it is handed and emits what was chosen. The
 * cookie, the version and the defaults live in `ConsentService`, which this library may
 * not import.
 */
@Component({
  selector: 'dui-cookie-banner',
  imports: [TranslocoPipe, HlmButtonImports, HlmSwitchImports],
  host: {
    /**
     * The server has no cookie to read, so it renders the banner; the browser reads the
     * real answer and may correctly render nothing. That is a legitimate difference,
     * not a hydration bug, and this is the sanctioned way to say so.
     */
    ngSkipHydration: 'true',
  },
  template: `
    @if (open()) {
      <div
        class="fixed inset-x-0 bottom-0 z-50 p-3 sm:p-4"
        role="dialog"
        aria-modal="false"
        [attr.aria-label]="'consent.title' | transloco"
      >
        <div class="bg-background mx-auto max-w-3xl rounded-lg border p-4 shadow-lg sm:p-5">
          <h2 class="text-sm font-semibold">{{ 'consent.title' | transloco }}</h2>
          <p class="text-muted-foreground mt-1 text-sm">{{ 'consent.body' | transloco }}</p>

          @if (expanded()) {
            <ul class="divide-border mt-4 divide-y border-y">
              @for (choice of draft(); track choice.id) {
                <li class="flex items-start justify-between gap-4 py-3">
                  <div>
                    <span class="block text-sm font-medium">{{ choice.labelKey | transloco }}</span>
                    <span class="text-muted-foreground block text-xs">
                      {{ choice.descriptionKey | transloco }}
                    </span>
                  </div>

                  <hlm-switch
                    class="mt-0.5 shrink-0"
                    [checked]="choice.granted"
                    [disabled]="choice.required"
                    [aria-label]="choice.labelKey | transloco"
                    (checkedChange)="toggle(choice.id, $event)"
                  />
                </li>
              }
            </ul>
          }

          <div class="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div class="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                class="text-muted-foreground hover:text-foreground underline underline-offset-2"
                (click)="expanded.set(!expanded())"
              >
                {{ (expanded() ? 'consent.hideDetails' : 'consent.customise') | transloco }}
              </button>

              @if (privacyUrl(); as url) {
                <a
                  class="text-muted-foreground hover:text-foreground underline underline-offset-2"
                  [href]="url"
                >
                  {{ 'consent.privacyLink' | transloco }}
                </a>
              }
            </div>

            <!--
              Same size, same row, same weight. The moment "reject" becomes a text link
              next to a filled "accept" button, this stops being a choice.
            -->
            <div class="flex flex-wrap gap-2">
              <button hlmBtn size="sm" variant="outline" type="button" (click)="rejectAll.emit()">
                {{ 'consent.rejectAll' | transloco }}
              </button>

              @if (expanded()) {
                <button hlmBtn size="sm" variant="secondary" type="button" (click)="saveDraft()">
                  {{ 'consent.saveChoices' | transloco }}
                </button>
              }

              <button hlmBtn size="sm" type="button" (click)="acceptAll.emit()">
                {{ 'consent.acceptAll' | transloco }}
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
})
export class CookieBannerComponent {
  readonly open = input.required<boolean>();
  readonly choices = input.required<readonly ConsentChoice[]>();
  /** Absolute or in-app; absent when the hosting application has no such page. */
  readonly privacyUrl = input<string>();

  readonly acceptAll = output<void>();
  readonly rejectAll = output<void>();
  readonly save = output<Record<string, boolean>>();

  protected readonly expanded = signal(false);

  /** Local edits to the switches, discarded unless "save choices" is pressed. */
  private readonly edits = signal<Record<string, boolean>>({});

  protected readonly draft = computed<readonly ConsentChoice[]>(() => {
    const edits = this.edits();
    return this.choices().map((choice) => ({
      ...choice,
      granted: choice.required || (edits[choice.id] ?? choice.granted),
    }));
  });

  protected toggle(id: string, granted: boolean): void {
    this.edits.update((current) => ({ ...current, [id]: granted }));
  }

  protected saveDraft(): void {
    this.save.emit(Object.fromEntries(this.draft().map((c) => [c.id, c.granted])));
  }
}
