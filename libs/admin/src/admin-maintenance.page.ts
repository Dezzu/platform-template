import { Component, computed, inject, linkedSignal, resource, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { form, FormField, maxLength } from '@angular/forms/signals';
import { firstValueFrom, merge } from 'rxjs';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmSwitchImports } from '@spartan-ng/helm/switch';
import { PLATFORM_ROLES, type PlatformRole } from '@app/contracts/permissions';
import { TextInputComponent } from '@app/ui/input';
import { PermissionsService, ToastService } from '@app/core';
import { AdminApi } from './admin.api';
import { AdminNavComponent } from './admin-nav.component';

/** What the form edits. Flat and free of nulls: an input binds to a value. */
interface MaintenanceForm {
  messageKey: string;
  until: string;
}

/**
 * The switch that takes the product offline.
 *
 * Deliberately a plain form rather than a big red button: enabling it, choosing who
 * still gets in and saying what the notice reads are one decision, and a one-click
 * toggle would make the first happen before the other two had been thought about.
 *
 * The allow list cannot be emptied — the contract refuses it — because the only way
 * back from locking everybody out would be an UPDATE against production.
 */
@Component({
  selector: 'app-admin-maintenance-page',
  imports: [
    TranslocoPipe,
    FormField,
    TextInputComponent,
    HlmButtonImports,
    HlmCardImports,
    HlmSwitchImports,
    AdminNavComponent,
  ],
  templateUrl: './admin-maintenance.page.html',
})
export class AdminMaintenancePage {
  private readonly api = inject(AdminApi);
  private readonly transloco = inject(TranslocoService);
  private readonly toasts = inject(ToastService);
  private readonly permissions = inject(PermissionsService);

  /** See admin-users.page.ts: `langChanges$` alone misses the first load. */
  private readonly translations = toSignal(
    merge(this.transloco.langChanges$, this.transloco.events$),
  );

  private readonly current = resource({
    params: () => true,
    loader: () => firstValueFrom(this.api.getMaintenance()),
  });

  protected readonly loading = computed(() => this.current.isLoading() && !this.current.hasValue());
  protected readonly failed = computed(() => this.current.error() !== undefined);
  protected readonly saving = signal(false);

  /**
   * `linkedSignal` rather than an effect: the model follows the loaded setting until
   * somebody edits it, and then it is theirs. An effect would race the first keystroke.
   */
  protected readonly enabled = linkedSignal(() =>
    this.current.hasValue() ? this.current.value().enabled : false,
  );
  protected readonly allowRoles = linkedSignal<readonly PlatformRole[]>(() =>
    this.current.hasValue() ? this.current.value().allowRoles : ['superadmin'],
  );
  protected readonly model = linkedSignal<MaintenanceForm>(() => {
    if (!this.current.hasValue()) return { messageKey: '', until: '' };
    const mode = this.current.value();
    return {
      messageKey: mode.messageKey ?? '',
      // `datetime-local` wants `YYYY-MM-DDTHH:mm`, not an offset-bearing ISO string.
      until: mode.until ? mode.until.slice(0, 16) : '',
    };
  });

  protected readonly notice = form(this.model, (path) => {
    maxLength(path.messageKey, 200);
  });

  /** The roles that can be put on the allow list, with `user` deliberately absent. */
  protected readonly selectableRoles = computed(() => {
    this.translations();
    return PLATFORM_ROLES.filter((role) => role !== 'user').map((role) => ({
      value: role,
      label: this.transloco.translate(`admin.roles.${role}`),
    }));
  });

  protected isAllowed(role: PlatformRole): boolean {
    return this.allowRoles().includes(role);
  }

  /**
   * Toggling the last role off is refused here as well as in the contract.
   *
   * Two checks for one rule, and it earns its keep: the server refusal arrives as a
   * 422 after the administrator has already pressed save, which is a bad moment to
   * discover that a form let them describe something impossible.
   */
  protected toggleRole(role: PlatformRole): void {
    const current = this.allowRoles();
    if (current.includes(role)) {
      if (current.length === 1) {
        this.toasts.error('maintenance.allowRolesEmpty');
        return;
      }
      this.allowRoles.set(current.filter((r) => r !== role));
      return;
    }
    this.allowRoles.set([...current, role]);
  }

  protected setEnabled(value: boolean): void {
    this.enabled.set(value);
  }

  protected setUntil(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.model.update((current) => ({ ...current, until: value }));
  }

  /**
   * Whether the person looking at this screen would themselves still get in.
   *
   * `platform.maintenance.manage` is held by superadmin alone (see
   * PLATFORM_ROLE_PERMISSIONS), so anybody who can see this form is a superadmin —
   * which makes "is superadmin still on the list" the right question. /me reports
   * permissions rather than the platform role, so this is the honest way to ask it.
   */
  protected readonly wouldLockMeOut = computed(() => {
    if (!this.enabled()) return false;
    if (!this.permissions.hasPlatform('platform.maintenance.manage')) return false;
    return !this.allowRoles().includes('superadmin');
  });

  /**
   * `(submit)` with an explicit preventDefault, not `(ngSubmit)` — see
   * project-form.page.ts: without FormsModule there is no NgForm, the binding attaches
   * to nothing, and the browser performs a native GET submit.
   */
  protected async save(event: Event): Promise<void> {
    event.preventDefault();
    if (this.notice().invalid() || this.saving()) return;

    this.saving.set(true);
    const { messageKey, until } = this.model();

    try {
      await firstValueFrom(
        this.api.setMaintenance({
          enabled: this.enabled(),
          // Empty is not the same as unset: the contract takes null for "no notice".
          messageKey: messageKey.trim() || null,
          until: until ? new Date(until).toISOString() : null,
          allowRoles: [...this.allowRoles()],
        }),
      );
      this.current.reload();
      // Reloads the session too: the banner in the shell reads /me, and without this
      // the administrator has to refresh to see the state they just set.
      await this.permissions.refresh();
      this.toasts.success(this.enabled() ? 'maintenance.turnedOn' : 'maintenance.turnedOff');
    } catch (error: unknown) {
      this.toasts.error(error);
    } finally {
      this.saving.set(false);
    }
  }
}
