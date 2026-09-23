import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ConsentService } from '@app/core/consent/consent.service';
import { environment } from '../../../environments/environment';
import {
  LEGAL_DOCUMENTS,
  type LegalDocument,
  type LegalDocumentId,
  type LegalLocale,
} from './legal-content';

/**
 * Renders one legal document.
 *
 * One component for both, with the id bound from the route's `data`: a privacy policy
 * and terms of service differ in words, not in shape, and two components would be the
 * same markup maintained twice.
 *
 * Prerendered like the rest of this application, so the text is in the served HTML —
 * which matters here more than anywhere: a policy that needs JavaScript to be read is
 * a policy a regulator cannot fetch with curl.
 */
@Component({
  selector: 'web-legal-page',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './legal.page.html',
})
export class LegalPage {
  private readonly transloco = inject(TranslocoService);
  /** Public: the footer's "cookie preferences" link brings the banner back. */
  protected readonly consent = inject(ConsentService);

  /** Bound from the route's `data` — see app.routes.ts and withComponentInputBinding(). */
  readonly doc = input.required<LegalDocumentId>();

  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();

  /** See app.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  protected readonly document = computed<LegalDocument>(() => {
    this.translations();
    const locale: LegalLocale = this.transloco.getActiveLang() === 'en' ? 'en' : 'it';
    return LEGAL_DOCUMENTS[this.doc()][locale];
  });
}
