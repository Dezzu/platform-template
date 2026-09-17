import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  organizationName: z.string().min(1),
  inviterName: z.string().default(''),
  role: z.string().min(1),
  url: z.url(),
});

/**
 * Sent by the Better Auth organization plugin when someone is invited.
 *
 * `organizationName` and `inviterName` are strings another user chose, which is why
 * the layout escapes every interpolated value — an invitation is the one email in the
 * product whose content a stranger can influence.
 */
export const organizationInvitationTemplate = defineTemplate({
  id: 'organization-invitation',
  schema,
  render: {
    it: (p, ctx) => ({
      subject: `${p.inviterName || 'Qualcuno'} ti ha invitato in ${p.organizationName}`,
      heading: `Invito a collaborare in ${p.organizationName}`,
      paragraphs: [
        p.inviterName
          ? `${p.inviterName} ti ha invitato a unirti a ${p.organizationName} su ${ctx.appName}.`
          : `Sei stato invitato a unirti a ${p.organizationName} su ${ctx.appName}.`,
        `Ruolo assegnato: ${p.role}.`,
      ],
      action: { label: 'Accetta l’invito', url: p.url },
      note: 'Se non ti aspettavi questo invito, puoi ignorare l’email: senza la tua conferma non viene creato nulla.',
    }),
    en: (p, ctx) => ({
      subject: `${p.inviterName || 'Someone'} invited you to ${p.organizationName}`,
      heading: `You have been invited to ${p.organizationName}`,
      paragraphs: [
        p.inviterName
          ? `${p.inviterName} invited you to join ${p.organizationName} on ${ctx.appName}.`
          : `You have been invited to join ${p.organizationName} on ${ctx.appName}.`,
        `Assigned role: ${p.role}.`,
      ],
      action: { label: 'Accept the invitation', url: p.url },
      note: 'If you were not expecting this, you can ignore the email — nothing is created without your confirmation.',
    }),
  },
});
