import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideI18n } from '@app/i18n';

import { routes } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // `withComponentInputBinding` is what binds a route's `data` to a component input:
    // the legal pages are one component told which document it is rendering.
    provideRouter(routes, withComponentInputBinding()),
    provideClientHydration(),

    /**
     * The marketing site translates too, which it did not before this phase.
     *
     * It costs the bundled catalogues on a page whose whole job is to be fast static
     * HTML — but the cookie banner is shared with the dashboard and speaks in i18n
     * keys, and a second banner with hard-coded strings would be the same decision
     * made twice, diverging on the first change. The legal documents themselves are
     * deliberately NOT in the catalogue: see pages/legal/legal-content.ts.
     */
    provideI18n('it'),
  ],
};
