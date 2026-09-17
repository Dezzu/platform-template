import { Component, computed, inject, resource, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import {
  PLATFORM_PERMISSIONS,
  PLATFORM_ROLES,
  platformOutranksOrEquals,
  type PlatformRole,
} from '@app/contracts/permissions';
import type { AdminUser } from '@app/contracts';
import { AppError, AuthService, CanPlatformDirective } from '@app/core';
import { AdminApi } from './admin.api';

/**
 * Every account on the platform.
 *
 * The controls mirror the server's rank rules, which matters more here than anywhere
 * else in the application: this screen is the one place where a mis-shown button is
 * not a 403 but a support person believing they did something they did not.
 */
@Component({
  selector: 'app-admin-users-page',
  imports: [TranslocoPipe, RouterLink, HlmButtonImports, CanPlatformDirective],
  templateUrl: './admin-users.page.html',
})
export class AdminUsersPage {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(AuthService);

  protected readonly platformPermissions = PLATFORM_PERMISSIONS;
  protected readonly roles = PLATFORM_ROLES;

  protected readonly search = signal('');
  protected readonly errorKey = signal<string | null>(null);
  protected readonly notice = signal<string | null>(null);

  protected readonly users = resource({
    params: () => ({ q: this.search() }),
    loader: ({ params }) =>
      firstValueFrom(this.api.listUsers({ size: 50, ...(params.q ? { q: params.q } : {}) })),
  });

  /** The viewer's platform role, which every rank decision below is measured against. */
  private readonly myRole = computed(() => this.auth.user()?.role ?? 'user');

  protected readonly grantableRoles = computed(() =>
    PLATFORM_ROLES.filter((role) => platformOutranksOrEquals(this.myRole(), role)),
  );

  protected isSelf(account: AdminUser): boolean {
    return account.id === this.auth.user()?.id;
  }

  /** Mirrors `assertMayActOn`: never offer an action the API is going to refuse. */
  protected canActOn(account: AdminUser): boolean {
    return platformOutranksOrEquals(this.myRole(), account.role ?? 'user');
  }

  /** Changing your own platform role is refused server-side — see the lockout note. */
  protected canChangeRoleOf(account: AdminUser): boolean {
    return this.canActOn(account) && !this.isSelf(account);
  }

  protected onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value.trim());
  }

  protected setRole(account: AdminUser, role: string): void {
    void this.run(async () => {
      await firstValueFrom(this.api.setRole(account.id, role as PlatformRole));
      this.users.reload();
    });
  }

  protected sendPasswordReset(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.sendPasswordReset(account.id));
      // No page reload: nothing about the account changed, an email was queued.
      this.notice.set('admin.resetLinkQueued');
    });
  }

  protected ban(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.ban(account.id, { reason: 'Banned from the admin area' }));
      this.users.reload();
    });
  }

  protected unban(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.unban(account.id));
      this.users.reload();
    });
  }

  protected revokeSessions(account: AdminUser): void {
    void this.run(async () => {
      await firstValueFrom(this.api.revokeSessions(account.id));
      this.notice.set('admin.sessionsRevoked');
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.errorKey.set(null);
    this.notice.set(null);
    try {
      await action();
    } catch (error: unknown) {
      this.errorKey.set(error instanceof AppError ? error.translationKey : 'errors.INTERNAL_ERROR');
    }
  }
}
