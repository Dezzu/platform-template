import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { email, form, FormField, required } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { TextInputComponent } from '@app/ui/input';
import { AuthService } from '@app/core';
import { environment } from '../../../environments/environment';

/**
 * Asks for a reset link.
 *
 * The confirmation is deliberately the same whether or not the address exists. Saying
 * "no such account" here would hand an attacker the account-existence oracle that the
 * login form is carefully built not to be — and it would do it without even needing a
 * password guess.
 */
@Component({
  selector: 'app-forgot-password-page',
  imports: [
    TextInputComponent,
    FormField,
    RouterLink,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './forgot-password.page.html',
  host: { class: 'flex min-h-screen items-center justify-center bg-background p-4' },
})
export class ForgotPasswordPage {
  private readonly auth = inject(AuthService);

  protected readonly appName = environment.appName;

  private readonly model = signal({ email: '' });
  protected readonly request = form(this.model, (path) => {
    required(path.email);
    email(path.email);
  });

  protected readonly submitting = signal(false);
  protected readonly sent = signal(false);

  /** `(submit)` with preventDefault — `(ngSubmit)` does not exist with Signal Forms. */
  protected async send(event: Event): Promise<void> {
    event.preventDefault();
    if (this.request().invalid() || this.submitting()) return;

    this.submitting.set(true);
    await this.auth.requestPasswordReset(
      this.model().email,
      `${window.location.origin}/reset-password`,
    );
    this.submitting.set(false);
    this.sent.set(true);
  }
}
