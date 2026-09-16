import { z } from 'zod';
import { ORG_ROLES } from '../../common/permissions';

export const UserProfileSchema = z.object({
  id: z.string().min(1),
  email: z.email(),
  name: z.string(),
  image: z.string().nullable(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const UpdateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    // Explicitly nullable: null clears the avatar, undefined leaves it untouched.
    image: z.url().max(2048).nullable().optional(),
  })
  .partial()
  // An empty PATCH is almost always a client bug, so reject it rather than silently
  // performing a no-op update.
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' });
export type UpdateProfile = z.infer<typeof UpdateProfileSchema>;

export const MeSchema = z.object({
  user: UserProfileSchema,
  activeOrganizationId: z.string().nullable(),
  /** Role inside the active organization; null when there is no active one. */
  role: z.enum(ORG_ROLES).nullable(),
  /**
   * The effective permission set, resolved server-side.
   *
   * Sent rather than derived in the browser from the role: the mapping must have one
   * owner, and it is the server. The client uses it to decide what to show — never to
   * decide what is allowed, which is always re-checked on the API.
   */
  permissions: z.array(z.string()),
  platformPermissions: z.array(z.string()),
});
export type Me = z.infer<typeof MeSchema>;
