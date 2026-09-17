import {
  type ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideIcons } from '@ng-icons/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { apiInterceptor, AuthService, PermissionsService, provideCore } from '@app/core';
import { provideI18n } from '@app/i18n';
import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { APP_ICONS } from './icons';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),

    // Registered application-wide because NAV_MANIFEST and the account menu name their
    // icons as strings: the component rendering them has no import to resolve.
    provideIcons(APP_ICONS),

    // libs/core never reads environment.* itself — it is handed its configuration here,
    // which is what lets the same library serve both applications.
    provideCore({
      apiUrl: environment.apiUrl,
      authUrl: environment.authUrl,
      loginRoute: '/sign-in',
      homeRoute: '/dashboard',
      defaultLocale: 'it',
      supportedLocales: ['it', 'en'],
    }),

    provideI18n('it'),

    /**
     * Resolves the session before the first route activates.
     *
     * On a full page reload the cookie exists but the application knows nothing yet.
     * Without this, every guard would run against an empty session and bounce a
     * signed-in user to the login page — the classic "it logs me out when I refresh".
     */
    provideAppInitializer(async () => {
      const auth = inject(AuthService);
      const permissions = inject(PermissionsService);

      await auth.refresh();
      if (auth.authenticated()) await permissions.refresh();
    }),
  ],
};
