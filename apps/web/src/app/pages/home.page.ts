import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { ConsentService } from '@app/core/consent/consent.service';
import { environment } from '../../environments/environment';

/**
 * The public landing page.
 *
 * Prerendered to static HTML: the content below is in the served markup, not painted
 * by JavaScript, which is the whole reason this is a separate application from the
 * dashboard.
 *
 * Its copy lives in the shared i18n catalogue rather than in this file. It used to be
 * hard-coded Italian, which was the one place in the repository that quietly broke the
 * rule in CLAUDE.md §1 — and once the cookie banner brought the i18n runtime here
 * anyway, keeping the strings out of it was paying the cost without taking the benefit.
 *
 * The pricing table lands here in the billing phase, reading /api/plans so a price
 * change is a seed and not a rebuild.
 */
@Component({
  selector: 'web-home-page',
  imports: [RouterLink, TranslocoPipe],
  templateUrl: './home.page.html',
})
export class HomePage {
  /** Public: the footer's "cookie preferences" link brings the banner back. */
  protected readonly consent = inject(ConsentService);

  protected readonly appName = environment.appName;
  protected readonly dashboardUrl = environment.dashboardUrl;
  protected readonly year = new Date().getFullYear();

  /** Ids, not sentences: the words live in the catalogue, keyed off these. */
  protected readonly features = ['tenancy', 'billing', 'deploy'] as const;
}
