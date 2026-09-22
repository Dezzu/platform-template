import { z } from 'zod';
import { defineTemplate } from './template.types';

const schema = z.object({
  organizationName: z.string().min(1),
  memberName: z.string().min(1),
  url: z.url(),
});

/**
 * The email half of the `member.joined` notification.
 *
 * Off by default — see the registry in packages/contracts — so this only renders for
 * somebody who asked for it. `memberName` is a name that person chose, which is why
 * the layout escapes every interpolated value.
 */
export const memberJoinedTemplate = defineTemplate({
  id: 'member-joined',
  schema,
  render: {
    it: (p, ctx) => ({
      subject: `${p.memberName} si è unito a ${p.organizationName}`,
      heading: `Un nuovo membro in ${p.organizationName}`,
      paragraphs: [
        `${p.memberName} ha accettato l’invito e fa ora parte di ${p.organizationName} su ${ctx.appName}.`,
      ],
      action: { label: 'Vedi i membri', url: p.url },
      note: 'Ricevi questa email perché hai attivato la notifica “nuovo membro”. Puoi disattivarla dalle preferenze.',
    }),
    en: (p, ctx) => ({
      subject: `${p.memberName} joined ${p.organizationName}`,
      heading: `A new member in ${p.organizationName}`,
      paragraphs: [
        `${p.memberName} accepted the invitation and is now part of ${p.organizationName} on ${ctx.appName}.`,
      ],
      action: { label: 'See the members', url: p.url },
      note: 'You are getting this because you turned on the “new member” notification. You can turn it off in your preferences.',
    }),
  },
});
