import { computed, inject, Service, signal } from '@angular/core';
import { Router } from '@angular/router';
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

  async signOut(): Promise<void> {
    await this.client.signOut();
    this.state.set({ user: null, activeOrganizationId: null });
    await this.router.navigateByUrl(this.config.loginRoute);
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
