import { Component } from '@angular/core';
import { environment } from '../../environments/environment';

/**
 * The public landing page.
 *
 * Prerendered to static HTML: the content below is in the served markup, not painted
 * by JavaScript, which is the whole reason this is a separate application from the
 * dashboard.
 *
 * The pricing table lands here in the billing phase, reading /api/plans so a price
 * change is a seed and not a rebuild.
 */
@Component({
  selector: 'web-home-page',
  templateUrl: './home.page.html',
})
export class HomePage {
  protected readonly appName = environment.appName;
  protected readonly year = new Date().getFullYear();

  protected readonly features = [
    {
      title: 'Multi-tenant dal giorno uno',
      body: 'Organizzazioni, ruoli e permessi, con isolamento verificato dai test.',
    },
    {
      title: 'Abbonamenti',
      body: 'Stripe Checkout e portale clienti, con webhook idempotenti.',
    },
    {
      title: 'Pronto al deploy',
      body: 'Docker, CI e infrastruttura descritta in Terraform.',
    },
  ];
}
