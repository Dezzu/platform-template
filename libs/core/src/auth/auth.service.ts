import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { SessionApi } from '../api/session.api';
import { CORE_CONFIG } from '../config/core.config';
import { AUTH_CLIENT } from './auth.client';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  role: string | null;
}

export interface SessionState {
  user: SessionUser | null;
  activeOrganizationId: string | null;
}

/**
 * The signed-in session, as signals.
 *
 * Signals hold the state, the Better Auth client does the transport — the split this
 * template applies everywhere. Components read `user()` and `authenticated()` and never
 * touch the client directly.
 *
 * There is no token here to read: the session is an httpOnly cookie, so JavaScript
 * cannot see it and an XSS cannot exfiltrate it.
 */
@Service()
export class AuthService {
  private readonly client = inject(AUTH_CLIENT);
  private readonly api = inject(SessionApi);
  private readonly router = inject(Router);
  private readonly config = inject(CORE_CONFIG);

  private readonly state = signal<SessionState>({ user: null, activeOrganizationId: null });
  /** True until the first session lookup settles, so guards do not redirect too early. */
  private readonly loading = signal(true);

  readonly user = computed(() => this.state().user);
  readonly activeOrganizationId = computed(() => this.state().activeOrganizationId);
  readonly authenticated = computed(() => this.state().user !== null);
  readonly resolving = this.loading.asReadonly();

  /**
   * Reads the session from the server.
   *
   * Called once during application initialisation: on a full page load the cookie
   * exists but the application knows nothing yet, and without this every guard would
   * bounce a signed-in user to the login page.
   */
  async refresh(): Promise<void> {
    try {
      const { data } = await this.client.getSession();
      this.state.set({
        user: data?.user ? toSessionUser(data.user) : null,
        activeOrganizationId: data?.session?.activeOrganizationId ?? null,
      });
    } catch {
      // A failed lookup means "not signed in" as far as the UI is concerned; the
      // interceptor surfaces the network error separately.
      this.state.set({ user: null, activeOrganizationId: null });
    } finally {
      this.loading.set(false);
    }
  }

  async signInWithPassword(email: string, password: string): Promise<{ error?: string }> {
    const { error } = await this.client.signIn.email({ email, password });
    if (error) return { error: error.code ?? 'UNKNOWN' };
    await this.refresh();
    return {};
  }

  async signInWithGoogle(callbackURL = this.config.homeRoute): Promise<void> {
    await this.client.signIn.social({ provider: 'google', callbackURL });
  }

  async signUp(email: string, password: string, name: string): Promise<{ error?: string }> {
    const { error } = await this.client.signUp.email({ email, password, name });
    if (error) return { error: error.code ?? 'UNKNOWN' };
    await this.refresh();
    return {};
  }

  /**
   * Asks for a reset link.
   *
   * Always resolves the same way, whether or not the address exists — Better Auth
   * answers identically on purpose, and surfacing anything else here would rebuild the
   * account-existence oracle that the login form carefully avoids being.
   */
  async requestPasswordReset(address: string, redirectTo: string): Promise<void> {
    await this.client.requestPasswordReset({ email: address, redirectTo });
  }

  /** Completes the reset with the token the emailed link carried. */
  async resetPassword(token: string, newPassword: string): Promise<{ error?: string }> {
    const { error } = await this.client.resetPassword({ token, newPassword });
    return error ? { error: error.code ?? 'UNKNOWN' } : {};
  }

  /**
   * Asks for the address confirmation email again.
   *
   * Goes through the same Better Auth endpoint the signup uses, so the message is the
   * templated one and lands in `email_message` like every other: a second path that
   * sent its own email would be a second thing to keep in step.
   *
   * The caller is responsible for not offering the button again immediately — the
   * server will happily send as many as it is asked for.
   */
  async resendVerificationEmail(callbackURL = this.config.homeRoute): Promise<{ error?: string }> {
    const address = this.user()?.email;
    if (!address) return { error: 'UNAUTHENTICATED' };

    const { error } = await this.client.sendVerificationEmail({ email: address, callbackURL });
    return error ? { error: error.code ?? 'UNKNOWN' } : {};
  }

  async signOut(): Promise<void> {
    await this.client.signOut();
    this.state.set({ user: null, activeOrganizationId: null });
    await this.router.navigateByUrl(this.config.loginRoute);
  }

  /**
   * Ends an impersonation: the server issues the administrator's own session back.
   *
   * A session operation, not an administrative one — the caller is whoever is being
   * impersonated, and they hold no platform rights at all. Deliberately does not
   * reload anything: the cookie has just been replaced, so every signal in memory
   * still describes somebody else, and the only honest next step is a full page load.
   * Where to land is the caller's decision.
   */
  async stopImpersonating(): Promise<void> {
    await firstValueFrom(this.api.stopImpersonating());
  }

  /** Switches the active organization and re-reads the session it changed. */
  async setActiveOrganization(organizationId: string): Promise<void> {
    await this.client.organization.setActive({ organizationId });
    await this.refresh();
  }
}

function toSessionUser(user: Record<string, unknown>): SessionUser {
  return {
    id: String(user['id']),
    email: String(user['email']),
    name: String(user['name'] ?? ''),
    image: (user['image'] as string | null) ?? null,
    emailVerified: Boolean(user['emailVerified']),
    twoFactorEnabled: Boolean(user['twoFactorEnabled']),
    role: (user['role'] as string | null) ?? null,
  };
}
