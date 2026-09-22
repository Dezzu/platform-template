import { z } from 'zod';
import { APP_MODES } from '../../common/app-mode';
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
  /**
   * What kind of product this deployment is.
   *
   * Reported by the server rather than compiled into the bundle: it is a server
   * setting, and a copy in environment.ts would be a second place to change that
   * nothing keeps in step. The client derives from it — who the subscription belongs
   * to, which menu entries make sense — instead of being told each answer separately.
   */
  mode: z.enum(APP_MODES),
  /**
   * The subscription that entitles the caller to paid features, or null.
   *
   * Sent so the interface can show a paywall instead of a broken screen. It decides
   * what to *show*; the API still refuses the request with 402, because anything the
   * browser holds can be edited by whoever is holding it.
   */
  subscription: z
    .object({
      plan: z.string(),
      status: z.string(),
      periodEnd: z.iso.datetime().nullable(),
      /** When it stops renewing, if cancelled. */
      cancelAt: z.iso.datetime().nullable(),
      /**
       * Set to end rather than renew.
       *
       * Derived server-side from both `cancel_at` and `cancel_at_period_end`: recent
       * Stripe API versions only set the former, so a client reading the boolean alone
       * would never show that a plan is ending.
       */
      willNotRenew: z.boolean(),
    })
    .nullable(),
});
export type Me = z.infer<typeof MeSchema>;
