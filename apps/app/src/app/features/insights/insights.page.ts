import { Component, inject, resource } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { AppError, PermissionsService } from '@app/core';
import { InsightsApi } from './insights.api';

/**
 * The worked example of a paid feature.
 *
 * The page is reachable without a subscription on purpose: hiding it means nobody
 * discovers the feature and nobody upgrades. What it shows instead is what they would
 * get and a way to get it.
 *
 * `subscribed()` decides what to render. The 402 branch is still handled, because the
 * server is the authority and the two can disagree — a subscription that lapsed between
 * loading the shell and opening this page, for instance.
 */
@Component({
  selector: 'app-insights-page',
  imports: [RouterLink, TranslocoPipe, HlmButtonImports, HlmCardImports],
  templateUrl: './insights.page.html',
})
export class InsightsPage {
  private readonly api = inject(InsightsApi);
  private readonly permissions = inject(PermissionsService);

  protected readonly subscribed = this.permissions.subscribed;

  protected readonly insights = resource({
    params: () => ({ subscribed: this.subscribed() }),
    loader: ({ params }) =>
      params.subscribed ? firstValueFrom(this.api.get()) : Promise.resolve(null),
  });

  /** True when the server refused for lack of a subscription rather than anything else. */
  protected readonly paymentRequired = (): boolean => {
    const error = this.insights.error();
    return error instanceof AppError && error.code === 'SUBSCRIPTION_REQUIRED';
  };
}
