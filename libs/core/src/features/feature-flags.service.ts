import { computed, Service, signal } from '@angular/core';
import type { ResolvedFlags } from '@app/contracts';

/**
 * Which features are on for the signed-in user.
 *
 * The values arrive already resolved with the session (`/me`) — the browser never sees
 * the definitions or the overrides, and never re-implements the ordering. That is
 * deliberate: a second implementation of "user override beats organization override
 * beats rollout" would drift from the first, and the symptom would be a feature that
 * appears in the menu and 403s when opened.
 *
 * Fed by PermissionsService, which owns the /me call. Injecting MeApi here instead
 * would mean two requests for one answer.
 *
 * Like permissions: this decides what the interface *shows*. The API re-checks every
 * call and answers 403 FEATURE_DISABLED, because anything the browser holds can be
 * edited by whoever is holding it.
 */
@Service()
export class FeatureFlagsService {
  private readonly state = signal<ResolvedFlags>({});

  /** Every flag with its resolved value. Mostly useful for debugging screens. */
  readonly all = computed(() => this.state());

  set(flags: ResolvedFlags): void {
    this.state.set(flags);
  }

  clear(): void {
    this.state.set({});
  }

  /**
   * An unknown key is off, matching the backend.
   *
   * The safe reading of "I have never heard of this flag" is "not for you": a typo in
   * a guard must not open a feature, and a flag that has not been declared yet is a
   * feature that has not shipped yet.
   */
  enabled(key: string): boolean {
    return this.state()[key] ?? false;
  }
}
