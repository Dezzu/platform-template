import { computed, inject, Service, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { Me, Permission, PlatformPermission } from '@app/contracts';
import { MeApi } from '../api/me.api';

/**
 * The effective permissions of the signed-in user, as signals.
 *
 * These decide what the UI *shows*. They never decide what is *allowed* — the API
 * re-checks every request, because anything the browser holds can be edited by whoever
 * is holding it. Hiding a button the server would refuse is a courtesy, not a control.
 */
@Service()
export class PermissionsService {
  private readonly api = inject(MeApi);

  private readonly state = signal<{
    permissions: ReadonlySet<string>;
    platform: ReadonlySet<string>;
    role: string | null;
    organizationId: string | null;
  }>({ permissions: new Set(), platform: new Set(), role: null, organizationId: null });

  readonly role = computed(() => this.state().role);
  readonly organizationId = computed(() => this.state().organizationId);
  readonly permissions = computed(() => this.state().permissions);

  /** Loads (or reloads) the permission set. Call after sign-in and after switching org. */
  async refresh(): Promise<Me | null> {
    try {
      const me = await firstValueFrom(this.api.get());
      this.state.set({
        permissions: new Set(me.permissions),
        platform: new Set(me.platformPermissions),
        role: me.role,
        organizationId: me.activeOrganizationId,
      });
      return me;
    } catch {
      this.clear();
      return null;
    }
  }

  clear(): void {
    this.state.set({
      permissions: new Set(),
      platform: new Set(),
      role: null,
      organizationId: null,
    });
  }

  has(permission: Permission): boolean {
    return this.state().permissions.has(permission);
  }

  anyOf(...permissions: readonly Permission[]): boolean {
    if (permissions.length === 0) return true;
    const held = this.state().permissions;
    return permissions.some((p) => held.has(p));
  }

  allOf(...permissions: readonly Permission[]): boolean {
    const held = this.state().permissions;
    return permissions.every((p) => held.has(p));
  }

  hasPlatform(permission: PlatformPermission): boolean {
    return this.state().platform.has(permission);
  }
}
