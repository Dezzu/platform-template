import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { form, FormField, minLength, required, validate } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { PasswordInputComponent } from '@app/ui/input';
import { AuthService } from '@app/core';
import { environment } from '../../../environments/environment';

/**
 * Where the emailed reset link lands.
 *
 * Better Auth's link goes to the API, which validates the token and redirects here
 * with `?token=`. A missing token therefore means someone opened this page directly,
 * or the link was mangled in transit — either way there is nothing to do but say so.
 */
@Component({
  selector: 'app-reset-password-page',
  imports: [
    PasswordInputComponent,
    FormField,
    RouterLink,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './reset-password.page.html',
  host: { class: 'flex min-h-screen items-center justify-center bg-background p-4' },
})
export class ResetPasswordPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;
  protected readonly token = inject(ActivatedRoute).snapshot.queryParamMap.get('token') ?? '';

  private readonly model = signal({ password: '', confirmation: '' });

  protected readonly reset = form(this.model, (path) => {
    required(path.password);
    // Must match the server's minPasswordLength, or the form lets through something
    // the API rejects with an error the user cannot act on.
    minLength(path.password, 12);
    required(path.confirmation);

    // Cross-field, so it is declared on the root rather than on either field —
    // the same shape the sign-up form uses.
    validate(path, (ctx) => {
      const { password, confirmation } = ctx.value();
      if (!password || !confirmation || password === confirmation) return null;
      return { kind: 'passwordMismatch' };
    });
  });

  protected readonly passwordsMismatch = computed(() =>
    this.reset()
      .errors()
      .some((error) => error.kind === 'passwordMismatch'),
  );

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (this.reset().invalid() || this.submitting() || !this.token) return;

    this.submitting.set(true);
    this.errorKey.set(null);

    const { error } = await this.auth.resetPassword(this.token, this.model().password);

    if (error) {
      this.submitting.set(false);
      // The common case by far is a link that was used already or has aged out.
      this.errorKey.set('auth.resetLinkInvalid');
      return;
    }

    // Signing in is a separate act: the reset invalidated the sessions, and landing on
    // the login form is what tells the user the new password works.
    await this.router.navigateByUrl('/sign-in');
  }
}
