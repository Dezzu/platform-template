import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  organizationName: z.string().min(1),
  url: z.url(),
});

/**
 * The email half of `billing.payment_failed`, and the one notification email nobody
 * can switch off.
 *
 * The reason is in the registry: a renewal that failed takes the product away within
 * days, and the person most likely to mute billing email is the one who most needs
 * this. It says what happened and where to fix it, and nothing else — no amount, no
 * card digits, no invoice link: this email goes to whoever holds `billing.manage`, and
 * it should be useless to anybody who intercepts it.
 */
export const paymentFailedTemplate = defineTemplate({
  id: 'payment-failed',
  schema,
  render: {
    it: (p, ctx) => ({
      subject: `Pagamento non riuscito per ${p.organizationName}`,
      heading: 'Il rinnovo non è andato a buon fine',
      paragraphs: [
        `Non siamo riusciti a incassare il rinnovo dell’abbonamento di ${p.organizationName} su ${ctx.appName}.`,
        'Di solito è una carta scaduta o un plafond insufficiente. Finché non viene risolto l’abbonamento resta attivo ancora per qualche giorno.',
      ],
      action: { label: 'Aggiorna il metodo di pagamento', url: p.url },
      note: 'Questa notifica non si può disattivare: senza, il primo segnale sarebbe la perdita dell’accesso.',
    }),
    en: (p, ctx) => ({
      subject: `Payment failed for ${p.organizationName}`,
      heading: 'The renewal did not go through',
      paragraphs: [
        `We could not collect the subscription renewal for ${p.organizationName} on ${ctx.appName}.`,
        'It is usually an expired card or insufficient funds. The subscription stays active for a few more days while it is unresolved.',
      ],
      action: { label: 'Update the payment method', url: p.url },
      note: 'This one cannot be switched off: without it, the first sign would be losing access.',
    }),
  },
});
