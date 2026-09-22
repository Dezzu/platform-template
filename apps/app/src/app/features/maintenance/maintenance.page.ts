import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { PermissionsService } from '@app/core';

/**
 * What a visitor sees while the product is closed.
 *
 * Outside the shell on purpose: the shell loads the session, the menu and the
 * permissions, and every one of those calls answers 503 to whoever ends up here. A
 * notice wrapped in a navigation that cannot load itself is worse than no shell at all.
 *
 * The retry asks the API one question — /me — and goes home if it is answered. That is
 * the honest test of "is it back", and it is the same call the shell would make next.
 */
@Component({
  selector: 'app-maintenance-page',
  imports: [TranslocoPipe, HlmButtonImports],
  templateUrl: './maintenance.page.html',
})
export class MaintenancePage {
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  protected readonly checking = signal(false);
  /** Set after a retry that changed nothing, so the button can say so. */
  protected readonly stillClosed = signal(false);

  protected async retry(): Promise<void> {
    if (this.checking()) return;
    this.checking.set(true);
    this.stillClosed.set(false);

    // refresh() swallows the failure and returns null — which here is the answer, not
    // an error to report: still closed.
    const me = await this.permissions.refresh();
    this.checking.set(false);

    if (me) {
      await this.router.navigateByUrl('/dashboard');
      return;
    }
    this.stillClosed.set(true);
  }
}
