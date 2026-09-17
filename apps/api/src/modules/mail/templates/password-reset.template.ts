import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  name: z.string().default(''),
  url: z.url(),
});

/**
 * The email whose link is, for as long as it is valid, equivalent to the password.
 * It is the reason `email_message` stores redacted parameters and the job is deleted
 * the moment it is sent — see the table comment.
 */
export const passwordResetTemplate = defineTemplate({
  id: 'password-reset',
  schema,
  render: {
    it: (p, ctx) => ({
      subject: `Reimposta la tua password — ${ctx.appName}`,
      heading: 'Reimposta la password',
      paragraphs: [
        p.name
          ? `Ciao ${p.name}, abbiamo ricevuto una richiesta di reimpostazione della password.`
          : 'Abbiamo ricevuto una richiesta di reimpostazione della password.',
      ],
      action: { label: 'Scegli una nuova password', url: p.url },
      note: 'Il link vale un’ora e può essere usato una sola volta. Se non hai richiesto tu il cambio, la tua password attuale resta valida e non devi fare nulla.',
    }),
    en: (p, ctx) => ({
      subject: `Reset your password — ${ctx.appName}`,
      heading: 'Reset your password',
      paragraphs: [
        p.name
          ? `Hi ${p.name}, we received a request to reset your password.`
          : 'We received a request to reset your password.',
      ],
      action: { label: 'Choose a new password', url: p.url },
      note: 'The link is valid for one hour and can be used once. If you did not ask for this, your current password still works and there is nothing to do.',
    }),
  },
});
