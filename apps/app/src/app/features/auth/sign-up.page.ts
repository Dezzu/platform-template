import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { email, form, FormField, minLength, required, validate } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { HlmInputImports } from '@spartan-ng/helm/input';
import { HlmLabelImports } from '@spartan-ng/helm/label';
import { AuthService, PermissionsService } from '@app/core';
import { environment } from '../../../environments/environment';

/**
 * Better Auth error codes this screen can explain; anything else becomes a generic
 * failure.
 *
 * The codes are asserted by an API test (auth-codes.e2e-spec.ts) rather than trusted:
 * a rename upstream would silently degrade every one of these into "something went
 * wrong", which is the least useful message a form can show.
 */
const ERROR_KEYS: Record<string, string> = {
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.emailTaken',
  USER_ALREADY_EXISTS: 'auth.emailTaken',
  PASSWORD_TOO_SHORT: 'auth.passwordTooShort',
};

@Component({
  selector: 'app-sign-up-page',
  imports: [
    FormField,
    RouterLink,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
    HlmInputImports,
    HlmLabelImports,
  ],
  templateUrl: './sign-up.page.html',
  host: { class: 'flex min-h-screen items-center justify-center bg-background p-4' },
})
export class SignUpPage {
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;

  private readonly model = signal({ name: '', email: '', password: '', confirmPassword: '' });

  protected readonly registration = form(this.model, (path) => {
    required(path.name);
    required(path.email);
    email(path.email);
    required(path.password);
    // Must match the server's minPasswordLength, or the form accepts something the API
    // then rejects with an error the user cannot act on.
    minLength(path.password, 12);
    required(path.confirmPassword);

    // Cross-field, so it is declared on the root rather than on either field.
    validate(path, (ctx) => {
      const { password, confirmPassword } = ctx.value();
      if (!password || !confirmPassword || password === confirmPassword) return null;
      return { kind: 'passwordMismatch' };
    });
  });

  protected readonly submitting = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly passwordsMismatch = computed(() =>
    this.registration()
      .errors()
      .some((error) => error.kind === 'passwordMismatch'),
  );

  /**
   * `(submit)` with an explicit preventDefault — see the note in sign-in.page.ts.
   * `(ngSubmit)` does nothing without FormsModule and lets the browser submit the
   * form natively, putting the password in the URL.
   */
  protected async signUp(event: Event): Promise<void> {
    event.preventDefault();

    if (this.registration().invalid() || this.submitting()) return;

    this.submitting.set(true);
    this.errorKey.set(null);

    const { name, email: address, password } = this.model();
    const { error } = await this.auth.signUp(address, password, name);

    if (error) {
      this.submitting.set(false);
      this.errorKey.set(ERROR_KEYS[error] ?? 'errors.INTERNAL_ERROR');
      return;
    }

    await this.permissions.refresh();
    await this.router.navigateByUrl('/dashboard');
  }

  protected signUpWithGoogle(): void {
    // Same endpoint as signing in: with an OAuth provider the two are one flow.
    void this.auth.signInWithGoogle();
  }
}
