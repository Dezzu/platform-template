import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { email, form, FormField, minLength, required, validate } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { TextInputComponent, PasswordInputComponent } from '@app/ui/input';
import { AuthService, PermissionsService, RETURN_URL_PARAM, safeReturnUrl } from '@app/core';
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
    TextInputComponent,
    PasswordInputComponent,
    FormField,
    RouterLink,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './sign-up.page.html',
  host: { class: 'flex min-h-screen items-center justify-center bg-background p-4' },
})
export class SignUpPage {
  /**
   * The legal pages live on the marketing site, so these are absolute and empty when
   * `webUrl` has not been set for the deployment — see environment.prod.ts.
   */
  protected readonly termsUrl = environment.webUrl ? `${environment.webUrl}/terms` : '';
  protected readonly privacyUrl = environment.webUrl ? `${environment.webUrl}/privacy-policy` : '';

  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);
  /**
   * Where to go once the session exists.
   *
   * An invitation link lands behind the auth guard, which bounces the visitor here
   * with the URL it could not open — including its query string, which for an
   * invitation is the only part that identifies it. Without honouring it, clicking an
   * invitation email and signing in drops you on an empty dashboard.
   */
  private readonly returnUrl =
    safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get(RETURN_URL_PARAM)) ??
    '/dashboard';

  protected readonly appName = environment.appName;

  /**
   * Carried on the link to the other authentication page: somebody invited who has no
   * account yet arrives here, clicks through to sign up, and must not lose the
   * invitation on the way.
   */
  protected readonly returnParams: Record<string, string> =
    this.returnUrl === '/dashboard' ? {} : { [RETURN_URL_PARAM]: this.returnUrl };

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
    await this.router.navigateByUrl(this.returnUrl);
  }

  protected signUpWithGoogle(): void {
    // Same endpoint as signing in: with an OAuth provider the two are one flow.
    void this.auth.signInWithGoogle(this.returnUrl);
  }
}
