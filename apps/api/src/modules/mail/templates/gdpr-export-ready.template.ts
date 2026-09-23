import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  name: z.string().min(1),
  scope: z.enum(['user', 'organization']),
  /** ISO 8601. Formatted per locale at render time, never by the caller. */
  expiresAt: z.iso.datetime(),
  /** The screen, not the archive. See below. */
  privacyUrl: z.url(),
});

/**
 * "Your export is ready" — and deliberately without a link to it.
 *
 * A presigned URL is the archive: anybody holding it holds every piece of personal
 * data the product has about somebody, for as long as it is valid. In an inbox it is
 * forwardable, searchable, and outlives the moment it was useful. So the email points
 * at the screen, and the screen mints a fresh URL behind the session that asks.
 *
 * `email_message` therefore has nothing sensitive to redact here, which is the same
 * property the verification and reset emails buy with their redaction rules.
 */
export const gdprExportReadyTemplate = defineTemplate({
  id: 'gdpr-export-ready',
  schema,
  render: {
    it: (p, ctx) => ({
      subject: 'La copia dei tuoi dati è pronta',
      heading: 'La copia dei tuoi dati è pronta',
      paragraphs: [
        `Ciao ${p.name}, l’archivio che hai richiesto su ${ctx.appName} è stato generato.`,
        p.scope === 'organization'
          ? 'Contiene i dati dell’organizzazione, compresi quelli delle persone che ne fanno parte: trattalo di conseguenza.'
          : 'Contiene i dati personali che il prodotto conserva su di te.',
      ],
      action: { label: 'Scarica la copia', url: p.privacyUrl },
      note: `Il link di download si genera al momento del click e l’archivio resta disponibile fino al ${formatDate(p.expiresAt, 'it')}. Dopo quella data va richiesto di nuovo.`,
    }),
    en: (p, ctx) => ({
      subject: 'Your data export is ready',
      heading: 'Your data export is ready',
      paragraphs: [
        `Hi ${p.name}, the archive you asked for on ${ctx.appName} has been generated.`,
        p.scope === 'organization'
          ? 'It holds the organization’s data, including that of the people in it — treat it accordingly.'
          : 'It holds the personal data the product keeps about you.',
      ],
      action: { label: 'Download the archive', url: p.privacyUrl },
      note: `The download link is minted when you click, and the archive stays available until ${formatDate(p.expiresAt, 'en')}. After that, ask for a new one.`,
    }),
  },
});

/** Rendered here rather than passed in, so the caller cannot format it for one locale. */
function formatDate(iso: string, locale: 'it' | 'en'): string {
  return new Date(iso).toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}
