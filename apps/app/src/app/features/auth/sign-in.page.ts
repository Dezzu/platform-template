import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { email, form, FormField, minLength, required } from '@angular/forms/signals';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { TextInputComponent, PasswordInputComponent } from '@app/ui/input';
import { AuthService, PermissionsService } from '@app/core';
import { environment } from '../../../environments/environment';

/**
 * Sign-in, as a page rather than a modal — forms are pages in this template.
 *
 * Uses Signal Forms (`@angular/forms/signals`), stable since Angular 22 and the
 * default for new forms here.
 */
@Component({
  selector: 'app-sign-in-page',
  imports: [
    TextInputComponent,
    PasswordInputComponent,
    FormField,
    RouterLink,
    TranslocoPipe,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './sign-in.page.html',
  host: { class: 'flex min-h-screen items-center justify-center bg-background p-4' },
})
export class SignInPage {
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);

  protected readonly appName = environment.appName;

  private readonly model = signal({ email: '', password: '' });

  protected readonly credentials = form(this.model, (path) => {
    required(path.email);
    email(path.email);
    required(path.password);
    // Must match the server's minPasswordLength, or the form lets through something
    // the API will reject with an error the user cannot act on.
    minLength(path.password, 12);
  });

  protected readonly submitting = signal(false);
  /** Error code from the server, translated as `errors.<CODE>`. */
  protected readonly errorKey = signal<string | null>(null);

  /**
   * `(submit)` with an explicit preventDefault, not `(ngSubmit)`.
   *
   * `ngSubmit` is an output of NgForm, which only exists when FormsModule is imported.
   * With Signal Forms there is no NgForm on the element, so the binding silently
   * attaches to nothing, the browser performs a native GET submit, and the fields end
   * up in the query string — including the password, which then reaches browser
   * history, Referer headers and access logs.
   */
  protected async signIn(event: Event): Promise<void> {
    event.preventDefault();

    if (this.credentials().invalid() || this.submitting()) return;

    this.submitting.set(true);
    this.errorKey.set(null);

    const { email: address, password } = this.model();
    const { error } = await this.auth.signInWithPassword(address, password);

    if (error) {
      this.submitting.set(false);
      // Deliberately the same message for a wrong password and an unknown address:
      // telling them apart turns the login form into an account-existence oracle.
      this.errorKey.set('auth.invalidCredentials');
      return;
    }

    await this.permissions.refresh();
    await this.router.navigateByUrl('/dashboard');
  }

  protected signInWithGoogle(): void {
    void this.auth.signInWithGoogle();
  }
}
