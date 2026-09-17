import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  name: z.string().default(''),
  url: z.url(),
});

/** Sent by Better Auth on signup and whenever an unverified address tries to sign in. */
export const emailVerificationTemplate = defineTemplate({
  id: 'email-verification',
  schema,
  render: {
    it: (p, ctx) => ({
      subject: `Conferma il tuo indirizzo email — ${ctx.appName}`,
      heading: p.name ? `Ciao ${p.name}, confermiamo che sei tu` : 'Confermiamo che sei tu',
      paragraphs: [
        `Per completare la registrazione su ${ctx.appName} conferma questo indirizzo email.`,
      ],
      action: { label: 'Conferma indirizzo', url: p.url },
      note: 'Se non hai creato tu questo account, puoi ignorare questa email.',
    }),
    en: (p, ctx) => ({
      subject: `Confirm your email address — ${ctx.appName}`,
      heading: p.name ? `Hi ${p.name}, let's confirm it's you` : "Let's confirm it's you",
      paragraphs: [`To finish signing up for ${ctx.appName}, confirm this email address.`],
      action: { label: 'Confirm address', url: p.url },
      note: 'If you did not create this account, you can ignore this email.',
    }),
  },
});
