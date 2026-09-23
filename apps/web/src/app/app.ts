import { Component, computed, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CONSENT_REGISTRY, type ConsentCategory } from '@app/contracts/consent';
import { CookieBannerComponent, type ConsentChoice } from '@app/ui/cookie-banner';
// Deep import rather than the '@app/core' barrel: this application is prerendered
// static marketing HTML, and the barrel would pull the auth client and every API
// service into it for the sake of one service that only reads a cookie.
import { ConsentService } from '@app/core/consent/consent.service';

@Component({
  selector: 'web-root',
  imports: [RouterOutlet, CookieBannerComponent],
  templateUrl: './app.html',
  host: { class: 'block min-h-screen' },
})
export class App {
  /** Public: the template binds the banner straight to it. */
  protected readonly consent = inject(ConsentService);

  /** Same mapping as the dashboard's root — libs/ui knows nothing of the registry. */
  protected readonly consentChoices = computed<ConsentChoice[]>(() => {
    const granted = this.consent.granted();
    return CONSENT_REGISTRY.map((category) => ({
      id: category.id,
      labelKey: category.labelKey,
      descriptionKey: category.descriptionKey,
      required: category.required,
      granted: granted[category.id],
    }));
  });

  protected saveConsent(granted: Record<string, boolean>): void {
    this.consent.save(granted as Record<ConsentCategory, boolean>);
  }
}
