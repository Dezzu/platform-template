import { InjectionToken, type Provider } from '@angular/core';

/**
 * Everything libs/core needs from the application hosting it.
 *
 * libs/core must never import `environment.*`: that would tie it to one application's
 * build configuration and make the same library unusable from the other app. The
 * values are handed in by whoever bootstraps — see provideCore().
 */
export interface CoreConfig {
  /** Base URL of the API, e.g. '/api' behind the nginx proxy. */
  apiUrl: string;
  /** Base URL Better Auth is mounted on, e.g. '/api/auth'. */
  authUrl: string;
  /** Where to send an unauthenticated user. */
  loginRoute: string;
  /** Where to land after signing in. */
  homeRoute: string;
  /**
   * Where to send a visitor while the product is closed for maintenance. Optional:
   * an application that has no such screen simply keeps showing the error.
   */
  maintenanceRoute?: string;
  defaultLocale: string;
  supportedLocales: readonly string[];
}

export const CORE_CONFIG = new InjectionToken<CoreConfig>('CORE_CONFIG');

/**
 * The only supported way to configure libs/core.
 *
 * ```ts
 * providers: [provideCore({ apiUrl: environment.apiUrl, ... })]
 * ```
 */
export function provideCore(config: CoreConfig): Provider[] {
  return [{ provide: CORE_CONFIG, useValue: config }];
}
