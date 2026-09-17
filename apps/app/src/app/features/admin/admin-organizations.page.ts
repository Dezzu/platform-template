import { Component, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import type { AdminOrganization } from '@app/contracts';
import { AdminApi } from './admin.api';

/**
 * Every organization on the platform.
 *
 * Read-only, deliberately: the operations that come up in support — change someone's
 * role, get them back in — belong to the members screen, and deleting a tenant from a
 * list is one mis-click away from deleting a customer. Expanding a row fetches its
 * members, so the common question ("who is in there?") is one click and not a page.
 */
@Component({
  selector: 'app-admin-organizations-page',
  imports: [TranslocoPipe, RouterLink, HlmButtonImports],
  templateUrl: './admin-organizations.page.html',
})
export class AdminOrganizationsPage {
  private readonly api = inject(AdminApi);

  protected readonly search = signal('');
  protected readonly expandedId = signal<string | null>(null);

  protected readonly organizations = resource({
    params: () => ({ q: this.search() }),
    loader: ({ params }) =>
      firstValueFrom(
        this.api.listOrganizations({ size: 50, ...(params.q ? { q: params.q } : {}) }),
      ),
  });

  /** Only ever loads the one row that is open. */
  protected readonly expanded = resource({
    params: () => this.expandedId(),
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.getOrganization(params)) : Promise.resolve(null),
  });

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value.trim());
  }

  protected toggle(organization: AdminOrganization): void {
    this.expandedId.update((current) => (current === organization.id ? null : organization.id));
  }
}
