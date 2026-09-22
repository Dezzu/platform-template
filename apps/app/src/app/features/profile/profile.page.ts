import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { form, FormField, maxLength, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { PERMISSIONS } from '@app/contracts/permissions';
import { TextInputComponent } from '@app/ui/input';
import {
  AppError,
  AuthService,
  CanDirective,
  MeApi,
  PermissionsService,
  ToastService,
} from '@app/core';
import { NotificationPreferencesComponent } from '../notifications/notification-preferences.component';

/**
 * The account screen, reachable from the profile menu.
 *
 * A page rather than a dialog — forms are pages in this template — and it writes
 * through the same PATCH /me the API validates with the shared contract, so the field
 * limits here and there cannot drift.
 *
 * Three blocks, in the order somebody asks about them: who you are, which organization
 * you are working in, and how the product is allowed to reach you.
 */
@Component({
  selector: 'app-profile-page',
  imports: [
    TextInputComponent,
    FormField,
    RouterLink,
    TranslocoPipe,
    CanDirective,
    HlmButtonImports,
    HlmCardImports,
    NotificationPreferencesComponent,
  ],
  templateUrl: './profile.page.html',
})
export class ProfilePage {
  private readonly api = inject(MeApi);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly toasts = inject(ToastService);

  protected readonly user = this.auth.user;
  protected readonly permissionKeys = PERMISSIONS;

  protected readonly emailVerified = computed(() => this.user()?.emailVerified ?? false);

  /**
   * The organization block, or null.
   *
   * Hidden entirely in `b2c`: there the organization exists to isolate data and the
   * person never chose it, so naming it on their profile would expose plumbing and
   * invite questions about something they cannot act on.
   */
  protected readonly organization = computed(() => {
    if (this.permissions.personalBilling()) return null;

    const id = this.permissions.organizationId();
    if (!id) return null;

    return {
      id,
      name: this.permissions.organizationName() ?? id,
      role: this.permissions.role(),
    };
  });

  private readonly model = signal({ name: this.auth.user()?.name ?? '' });

  protected readonly profile = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, 100);
  });

  protected readonly saving = signal(false);
  protected readonly savedAt = signal<number | null>(null);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly resending = signal(false);
  /**
   * Set once the link has gone out, and never reset.
   *
   * The button disappears rather than staying clickable: the server sends one email
   * per press, and a button that looks unchanged after a successful send is a button
   * people press three more times. Reloading the page brings it back, which is the
   * right amount of friction for the case where the mail genuinely did not arrive.
   */
  protected readonly resent = signal(false);

  /** Asks for the confirmation email again. Only offered while unverified. */
  protected async resendVerification(): Promise<void> {
    if (this.resending() || this.resent()) return;
    this.resending.set(true);

    const { error } = await this.auth.resendVerificationEmail('/dashboard');
    this.resending.set(false);

    if (error) {
      this.toasts.error(`errors.${error}`);
      return;
    }

    this.resent.set(true);
    this.toasts.success('profile.verificationSent', { email: this.user()?.email ?? '' });
  }

  protected async save(event: Event): Promise<void> {
    // See sign-in.page.ts: (ngSubmit) does nothing without FormsModule, and the
    // browser would submit the form natively.
    event.preventDefault();

    if (this.profile().invalid() || this.saving()) return;

    this.saving.set(true);
    this.errorKey.set(null);

    try {
      await firstValueFrom(this.api.update({ name: this.model().name.trim() }));
      // Re-reads the session so the name in the header updates immediately.
      await this.auth.refresh();
      this.savedAt.set(Date.now());
    } catch (error: unknown) {
      this.errorKey.set(error instanceof AppError ? error.translationKey : 'errors.INTERNAL_ERROR');
    } finally {
      this.saving.set(false);
    }
  }
}
