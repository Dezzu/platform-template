import { computed, inject, Service, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
// Deep import for the VALUES: the '@app/contracts' barrel re-exports Zod schemas built
// at module top level, which the bundler cannot remove — and this file is on the eager
// path, so importing a function from the barrel drags Zod into the initial bundle.
// It did, and the build budget caught it.
import { billsThePerson, DEFAULT_APP_MODE, type AppMode } from '@app/contracts/app-mode';
import type { MaintenanceMode, Me, Permission, PlatformPermission } from '@app/contracts';
import { MeApi } from '../api/me.api';
import { FeatureFlagsService } from '../features/feature-flags.service';

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
  /**
   * Fed from here because /me answers all of it in one call. The flags live in their
   * own service because they are not permissions and nothing should have to inject a
   * service named for authorization in order to ask whether a feature exists.
   */
  private readonly flags = inject(FeatureFlagsService);

  private readonly state = signal<{
    permissions: ReadonlySet<string>;
    platform: ReadonlySet<string>;
    role: string | null;
    organizationId: string | null;
    organizationName: string | null;
    mode: AppMode;
    impersonating: boolean;
    maintenance: MaintenanceMode | null;
    subscribed: boolean;
  }>({
    permissions: new Set(),
    platform: new Set(),
    role: null,
    organizationId: null,
    organizationName: null,
    mode: DEFAULT_APP_MODE,
    impersonating: false,
    maintenance: null,
    subscribed: false,
  });

  readonly role = computed(() => this.state().role);
  readonly organizationId = computed(() => this.state().organizationId);
  /** What a person recognises the tenant by. Null when there is no active one. */
  readonly organizationName = computed(() => this.state().organizationName);
  readonly permissions = computed(() => this.state().permissions);
  /** Server-reported: what kind of product this deployment is. */
  readonly mode = computed(() => this.state().mode);
  /** True while a platform administrator is using the application as this account. */
  readonly impersonating = computed(() => this.state().impersonating);
  /**
   * The notice in force, when the product is closed and this account is one of the few
   * still let in. Null for everybody else — they never got an answer to say so.
   *
   * Here rather than in a service of its own for the same reason `impersonating` is:
   * it arrives with the session, and it is a fact about this session rather than a
   * separate thing to fetch.
   */
  readonly maintenance = computed(() => this.state().maintenance);
  /** Derived, never configured separately — see app-mode.ts. */
  readonly personalBilling = computed(() => billsThePerson(this.state().mode));
  /**
   * Whether the reference has a subscription that entitles it to paid features.
   *
   * Decides what the interface shows. The API refuses regardless, with 402 — this is
   * a courtesy to the reader, never the control.
   */
  readonly subscribed = computed(() => this.state().subscribed);

  /** Loads (or reloads) the permission set. Call after sign-in and after switching org. */
  async refresh(): Promise<Me | null> {
    try {
      const me = await firstValueFrom(this.api.get());
      this.flags.set(me.flags);
      this.state.set({
        permissions: new Set(me.permissions),
        platform: new Set(me.platformPermissions),
        role: me.role,
        organizationId: me.activeOrganizationId,
        organizationName: me.organizationName,
        mode: me.mode,
        impersonating: me.impersonating,
        maintenance: me.maintenance,
        subscribed: me.subscription !== null,
      });
      return me;
    } catch {
      this.clear();
      return null;
    }
  }

  clear(): void {
    this.flags.clear();
    this.state.set({
      permissions: new Set(),
      platform: new Set(),
      role: null,
      organizationId: null,
      organizationName: null,
      mode: DEFAULT_APP_MODE,
      impersonating: false,
      maintenance: null,
      subscribed: false,
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

  anyOfPlatform(...permissions: readonly PlatformPermission[]): boolean {
    // Empty means "no platform right required", matching anyOf. An admin area entry
    // that declared none would be visible to everyone, which is why every caller in
    // the manifest states them explicitly.
    if (permissions.length === 0) return true;
    const held = this.state().platform;
    return permissions.some((p) => held.has(p));
  }
}
