import { Component, inject, resource, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { PERMISSIONS } from '@app/contracts/permissions';
import type { Project } from '@app/contracts';
import { AppError, CanDirective } from '@app/core';
import { ProjectsApi } from './projects.api';

/**
 * Reference feature screen.
 *
 * `*appCan` hides the destructive controls the user could not use anyway — a courtesy,
 * not a control: the API re-checks every call, which is why the 403 path is still
 * handled below.
 */
@Component({
  selector: 'app-projects-page',
  imports: [TranslocoPipe, HlmButtonImports, CanDirective],
  templateUrl: './projects.page.html',
})
export class ProjectsPage {
  private readonly api = inject(ProjectsApi);

  protected readonly permissions = PERMISSIONS;
  protected readonly errorKey = signal<string | null>(null);

  protected readonly projects = resource({
    loader: () => firstValueFrom(this.api.list({ size: 50 })),
  });

  protected async remove(project: Project): Promise<void> {
    this.errorKey.set(null);
    try {
      await firstValueFrom(this.api.remove(project.id));
      this.projects.reload();
    } catch (error: unknown) {
      // The server is the authority: a hidden button is not a guarantee, so a refusal
      // still has to be shown rather than swallowed.
      this.errorKey.set(error instanceof AppError ? error.translationKey : 'errors.INTERNAL_ERROR');
    }
  }
}
