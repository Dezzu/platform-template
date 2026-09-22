import { Component, computed, inject, resource, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { form, FormField, minLength, required } from '@angular/forms/signals';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { HlmButtonImports } from '@spartan-ng/helm/button';
import { HlmCardImports } from '@spartan-ng/helm/card';
import { PasswordInputComponent, TextInputComponent } from '@app/ui/input';
import {
  AppError,
  AuthService,
  PermissionsService,
  RETURN_URL_PARAM,
  ToastService,
} from '@app/core';
import { MembersApi } from './members.api';

/** What a brand-new colleague has to fill in: a name and a password. */
interface SignUpForm {
  name: string;
  password: string;
}

/**
 * Where an invitation email lands — and it is a PUBLIC page, which is the whole point.
 *
 * The person an invitation is for usually has no account: the link exists to let them
 * make one. Putting it behind the auth guard turned it into a login form they could
 * not satisfy — they arrived, were bounced to sign-in, and had no way to set a
 * password. That was the bug.
 *
 * So the page reads the invitation anonymously and then offers exactly one of three
 * things: create an account (address fixed, taken from the invitation), sign in, or —
 * if a session is already there — accept. Nothing is joined without an explicit click,
 * because a forwarded link must not add whoever it was forwarded to.
 */
@Component({
  selector: 'app-accept-invitation-page',
  imports: [
    TranslocoPipe,
    RouterLink,
    FormField,
    TextInputComponent,
    PasswordInputComponent,
    HlmButtonImports,
    HlmCardImports,
  ],
  templateUrl: './accept-invitation.page.html',
  host: { class: 'bg-background flex min-h-screen items-center justify-center p-4' },
})
export class AcceptInvitationPage {
  private readonly api = inject(MembersApi);
  private readonly auth = inject(AuthService);
  private readonly permissions = inject(PermissionsService);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  protected readonly invitationId = inject(ActivatedRoute).snapshot.queryParamMap.get('id') ?? '';

  protected readonly busy = signal(false);
  protected readonly errorKey = signal<string | null>(null);

  protected readonly invitation = resource({
    params: () => this.invitationId,
    loader: ({ params }) =>
      params ? firstValueFrom(this.api.preview(params)) : Promise.resolve(null),
  });

  protected readonly loading = computed(() => this.invitation.isLoading());
  protected readonly failed = computed(() => this.invitation.error() !== undefined);
  protected readonly details = computed(() =>
    this.invitation.hasValue() ? this.invitation.value() : null,
  );

  /** Anything but `pending` — already used, revoked, or past its date. */
  protected readonly unusable = computed(() => {
    const details = this.details();
    if (!details) return false;
    return details.status !== 'pending' || new Date(details.expiresAt) < new Date();
  });

  protected readonly signedIn = computed(() => this.auth.authenticated());

  /**
   * Signed in, but as somebody else.
   *
   * Worth saying out loud rather than letting the accept fail: the usual cause is a
   * shared computer, and "sign out and try again" is an instruction, where a refusal
   * from the server is a puzzle.
   */
  protected readonly wrongAccount = computed(() => {
    const details = this.details();
    const current = this.auth.user();
    if (!details || !current) return false;
    return current.email.toLowerCase() !== details.email.toLowerCase();
  });

  /** The sign-in page, told to come back here afterwards. */
  protected readonly signInParams = computed(() => ({
    [RETURN_URL_PARAM]: `/accept-invitation?id=${this.invitationId}`,
  }));

  protected readonly model = signal<SignUpForm>({ name: '', password: '' });
  protected readonly registration = form(this.model, (path) => {
    required(path.name);
    required(path.password);
    // The server's minimum. A form that accepts less refuses the work only after the
    // person has done it.
    minLength(path.password, 12);
  });

  /**
   * Creates the account for the invited address and joins in one go.
   *
   * The address comes from the invitation and is never typed: the account being made
   * is the one that was invited, and letting it be edited would make this a general
   * sign-up form that happens to sit on an invitation page.
   */
  protected async register(event: Event): Promise<void> {
    event.preventDefault();

    const details = this.details();
    if (!details || this.registration().invalid() || this.busy()) return;

    this.busy.set(true);
    this.errorKey.set(null);

    const { name, password } = this.model();
    const { error } = await this.auth.signUp(details.email, password, name.trim());

    if (error) {
      this.busy.set(false);
      this.errorKey.set(`errors.${error}`);
      return;
    }

    /**
     * With email verification required, signing up does not establish a session — so
     * there is nobody to accept as, and the honest thing is to say so rather than to
     * fail on the next call. The invitation stays valid; the link works again once the
     * address is confirmed.
     */
    if (!this.auth.authenticated()) {
      this.busy.set(false);
      this.toasts.success('members.verifyThenReturn', { email: details.email });
      return;
    }

    await this.acceptNow();
  }

  protected async accept(): Promise<void> {
    if (this.busy() || !this.invitationId) return;
    this.busy.set(true);
    this.errorKey.set(null);
    await this.acceptNow();
  }

  private async acceptNow(): Promise<void> {
    try {
      const { organizationId } = await firstValueFrom(this.api.accept(this.invitationId));

      // Switch to the organization just joined, then reload the permission set: the
      // sidebar and every guard read it, and without this the new member lands on a
      // dashboard still scoped to whatever tenant they had before — or to none.
      if (organizationId) await this.auth.setActiveOrganization(organizationId);
      await this.permissions.refresh();
      await this.router.navigateByUrl('/dashboard');
    } catch (error: unknown) {
      this.busy.set(false);
      this.errorKey.set(error instanceof AppError ? error.translationKey : 'errors.INTERNAL_ERROR');
    }
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }

  protected decline(): void {
    void this.router.navigateByUrl('/dashboard');
  }
}
