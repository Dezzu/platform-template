import { Component, inject, signal } from '@angular/core';
import { form, FormField, maxLength, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { TextInputComponent } from '@app/ui/input';
import { AppError, AuthService, MeApi } from '@app/core';
import { NotificationPreferencesComponent } from '../notifications/notification-preferences.component';

/**
 * The account screen, reachable from the profile menu.
 *
 * A page rather than a dialog — forms are pages in this template — and it writes
 * through the same PATCH /me the API validates with the shared contract, so the field
 * limits here and there cannot drift.
 */
@Component({
  selector: 'app-profile-page',
  imports: [
    TextInputComponent,
    FormField,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
    NotificationPreferencesComponent,
  ],
  templateUrl: './profile.page.html',
})
export class ProfilePage {
  private readonly api = inject(MeApi);
  private readonly auth = inject(AuthService);

  protected readonly user = this.auth.user;

  private readonly model = signal({ name: this.auth.user()?.name ?? '' });

  protected readonly profile = form(this.model, (path) => {
    required(path.name);
    maxLength(path.name, 100);
  });

  protected readonly saving = signal(false);
  protected readonly savedAt = signal<number | null>(null);
  protected readonly errorKey = signal<string | null>(null);

  protected async save(event: Event): Promise<void> {
    // See sign-in.page.ts: (ngSubmit) does nothing without FormsModule, and the
    // browser would submit the form natively.
    event.preventDefault();

    if (this.profile().invalid() || this.saving()) return;

    this.saving.set(true);
    this.errorKey.set(null);

    try {
      await firstValueFrom(this.api.update({ name: this.model().name }));
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
