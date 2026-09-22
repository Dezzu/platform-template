import { z } from 'zod';
import { ORG_ROLES } from '../../common/permissions';
import { PageQuerySchema } from '../../common/pagination';

export const INVITATION_STATUSES = ['pending', 'accepted', 'rejected', 'canceled'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * A membership, with just enough of the user attached to render a row.
 *
 * The nested user is a deliberate denormalisation of the response, not of the
 * database: the members screen is useless without a name and an email, and making the
 * client fetch them one by one would be a request per row.
 */
export const MemberSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  role: z.enum(ORG_ROLES),
  createdAt: z.iso.datetime(),
  user: z.object({
    id: z.string().min(1),
    name: z.string(),
    email: z.email(),
    image: z.string().nullable(),
  }),
});
export type Member = z.infer<typeof MemberSchema>;

export const MemberListQuerySchema = PageQuerySchema.extend({
  role: z.enum(ORG_ROLES).optional(),
});
export type MemberListQuery = z.infer<typeof MemberListQuerySchema>;

export const MemberRoleUpdateSchema = z.object({
  role: z.enum(ORG_ROLES),
});
export type MemberRoleUpdate = z.infer<typeof MemberRoleUpdateSchema>;

export const InvitationSchema = z.object({
  id: z.string().min(1),
  organizationId: z.string().min(1),
  email: z.email(),
  role: z.enum(ORG_ROLES),
  status: z.enum(INVITATION_STATUSES),
  expiresAt: z.iso.datetime(),
  inviterId: z.string().min(1),
});
export type Invitation = z.infer<typeof InvitationSchema>;

/**
 * Note what is absent: organizationId. The tenant comes from the authenticated
 * context — accepting it here would let anyone invite themselves into any tenant.
 */
export const InvitationCreateSchema = z.object({
  email: z.email().trim().toLowerCase(),
  role: z.enum(ORG_ROLES),
});
export type InvitationCreate = z.infer<typeof InvitationCreateSchema>;

/**
 * What the accept screen shows BEFORE the user commits.
 *
 * Readable without being a member — that is the whole point, since the recipient is
 * not one yet — so it carries only what an invitation email already told them.
 */
/**
 * What an invitation says, answered to whoever holds the link — signed in or not.
 *
 * Public because the person it is for usually has no account yet: the whole purpose of
 * the link is to let them make one. Requiring a session first is how an invitation
 * turns into a login form that cannot be satisfied.
 *
 * The invited address is included because the account has to be created for exactly
 * that address and the form must not let anyone type a different one. Holding the link
 * already implies having read the mailbox it was sent to — and what stops a forwarded
 * link from adding the wrong person is not this endpoint but the accept, which refuses
 * unless the session's address is the invited one.
 */
export const InvitationPreviewSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  role: z.enum(ORG_ROLES),
  status: z.enum(INVITATION_STATUSES),
  organizationName: z.string(),
  inviterName: z.string(),
  expiresAt: z.iso.datetime(),
  /**
   * Whether that address already has an account, so the page can offer the right of
   * two doors instead of asking the reader to remember.
   *
   * A small disclosure to somebody already holding a secret token tied to that
   * address, in exchange for not making a new colleague guess whether they have signed
   * up here before.
   */
  accountExists: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;
