import { Component, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { AppError, AuthService, PermissionsService } from '@app/core';
import { MembersApi } from './members.api';

/**
 * Where an invitation email lands.
 *
 * Behind the auth guard on purpose: Better Auth checks that the signed-in address is
 * the invited one, so the recipient has to prove who they are before they can even
 * read the invitation. Someone who is not signed in gets bounced to the login page and
 * comes back here afterwards, which is the right order — accepting silently on click
 * would mean a link forwarded to a colleague adds the colleague.
 */
@Component({
  selector: 'app-accept-invitation-page',
  imports: [TranslocoPipe, HlmButtonImports, HlmCardImports],
  templateUrl: './accept-invitation.page.html',
  host: { class: 'flex min-h-screen items-center justify-center bg-background p-4' },
})
export class AcceptInvitationPage {
  private readonly api = inject(MembersApi);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  protected readonly invitationId = inject(ActivatedRoute).snapshot.queryParamMap.get('id') ?? '';

  protected readonly accepting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly invitation = resource({
    params: () => this.invitationId,
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.preview(params)) : Promise.resolve(null),
  });

  protected async accept(): Promise<void> {
    if (this.accepting() || !this.invitationId) return;

    this.accepting.set(true);
    this.errorKey.set(null);

    try {
      const { organizationId } = await firstValueFrom(this.api.accept(this.invitationId));

      // Switch to the organization just joined, then reload the permission set: the
      // sidebar and every guard read it, and without this the user lands on a dashboard
      // still scoped to whatever tenant they had before.
      if (organizationId) await this.auth.setActiveOrganization(organizationId);
      await this.permissions.refresh();
      await this.router.navigateByUrl('/dashboard');
    } catch (error: unknown) {
      this.accepting.set(false);
      this.errorKey.set(error instanceof AppError ? error.translationKey : 'errors.INTERNAL_ERROR');
    }
  }

  protected decline(): void {
    void this.router.navigateByUrl('/dashboard');
  }
}
