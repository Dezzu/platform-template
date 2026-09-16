import { Component, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { AuthService, PermissionsService } from '@app/core';

@Component({
  selector: 'app-dashboard-page',
  imports: [TranslocoPipe, HlmCardImports],
  template: `
    <h1 class="mb-4 text-2xl font-semibold">{{ 'nav.dashboard' | transloco }}</h1>

    <div hlmCard class="max-w-md">
      <div hlmCardHeader>
        <h2 hlmCardTitle>{{ user()?.name || user()?.email }}</h2>
        <p hlmCardDescription>{{ user()?.email }}</p>
      </div>
      <div hlmCardContent class="space-y-1 text-sm">
        <p>
          <span class="text-muted-foreground">role:</span>
          {{ role() ?? '—' }}
        </p>
        <p>
          <span class="text-muted-foreground">organization:</span>
          {{ organizationId() ?? '—' }}
        </p>
        <p>
          <span class="text-muted-foreground">permissions:</span>
          {{ permissionCount() }}
        </p>
      </div>
    </div>
  `,
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);

  protected readonly user = this.auth.user;
  protected readonly role = this.permissions.role;
  protected readonly organizationId = this.permissions.organizationId;
  protected readonly permissionCount = () => this.permissions.permissions().size;
}
