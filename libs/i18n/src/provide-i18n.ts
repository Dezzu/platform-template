import { isDevMode, type Provider } from '@angular/core';
import {
  provideTransloco,
  translocoConfig,
  TranslocoService,
  type Translation,
  type TranslocoLoader,
} from '@jsverse/transloco';
import en from './locales/en.json';
import it from './locales/it.json';

export const SUPPORTED_LOCALES = ['it', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

const TRANSLATIONS: Record<string, Translation> = { it, en };

/**
 * Serves the bundled translations.
 *
 * Imported rather than fetched: two locales are a few kilobytes, so an HTTP round trip
 * on startup would buy nothing and cost a flash of untranslated keys. Switch to the
 * HTTP loader if the catalogue grows enough that lazy-loading a language pays for
 * itself.
 */
class BundledLoader implements TranslocoLoader {
  getTranslation(lang: string): Promise<Translation> {
    return Promise.resolve(TRANSLATIONS[lang] ?? TRANSLATIONS['it'] ?? {});
  }
}

export function provideI18n(defaultLocale: SupportedLocale = 'it'): Provider[] {
  return [
    provideTransloco({
      config: translocoConfig({
        availableLangs: [...SUPPORTED_LOCALES],
        defaultLang: defaultLocale,
        fallbackLang: 'it',
        reRenderOnLangChange: true,
        // In development a missing key should be loud; in production it should not
        // paint a stack trace over the interface.
        missingHandler: { logMissingKey: isDevMode(), useFallbackTranslation: true },
        prodMode: !isDevMode(),
      }),
      loader: BundledLoader,
    }),
  ];
}

export { TranslocoService };
