import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  name: z.string().min(1),
  subjectType: z.enum(['user', 'organization']),
  scheduledFor: z.iso.datetime(),
  privacyUrl: z.url(),
});

/**
 * The confirmation that an erasure is pending, and the way to call it off.
 *
 * Sent even though the person just clicked the button, because this is the one email
 * that matters if they did not: an account taken over and then erased would otherwise
 * disappear silently, and the grace period only protects somebody who knows about it.
 */
export const accountDeletionScheduledTemplate = defineTemplate({
  id: 'account-deletion-scheduled',
  schema,
  render: {
    it: (p, ctx) => ({
      subject:
        p.subjectType === 'organization'
          ? 'Cancellazione dell’organizzazione programmata'
          : 'Cancellazione del tuo account programmata',
      heading: 'Cancellazione programmata',
      paragraphs: [
        p.subjectType === 'organization'
          ? `Ciao ${p.name}, abbiamo registrato la richiesta di cancellare la tua organizzazione su ${ctx.appName}.`
          : `Ciao ${p.name}, abbiamo registrato la richiesta di cancellare il tuo account su ${ctx.appName}.`,
        `L’operazione verrà eseguita il ${formatDate(p.scheduledFor, 'it')} e non è reversibile. Fino ad allora puoi annullarla in qualsiasi momento.`,
        'Se non sei stato tu a chiederla, annullala subito e cambia la password.',
      ],
      action: { label: 'Annulla la cancellazione', url: p.privacyUrl },
    }),
    en: (p, ctx) => ({
      subject:
        p.subjectType === 'organization'
          ? 'Your organization is scheduled for erasure'
          : 'Your account is scheduled for erasure',
      heading: 'Erasure scheduled',
      paragraphs: [
        p.subjectType === 'organization'
          ? `Hi ${p.name}, we have recorded a request to erase your organization on ${ctx.appName}.`
          : `Hi ${p.name}, we have recorded a request to erase your account on ${ctx.appName}.`,
        `It will be carried out on ${formatDate(p.scheduledFor, 'en')} and cannot be undone. Until then you can call it off at any time.`,
        'If this was not you, call it off now and change your password.',
      ],
      action: { label: 'Call off the erasure', url: p.privacyUrl },
    }),
  },
});

function formatDate(iso: string, locale: 'it' | 'en'): string {
  return new Date(iso).toLocaleString(locale === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });
}
