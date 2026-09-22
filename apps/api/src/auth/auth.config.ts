import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { adminAc, defaultAc, defaultStatements, userAc } from 'better-auth/plugins/admin/access';
import { createStripePlugin } from '../modules/billing/stripe-plugin';
import { authMailer } from '../modules/mail/mail.bridge';
import { ensurePersonalOrganization } from './personal-organization';
import * as schema from '@app/db';
import { db } from '../database/db';

const env = (name: string): string | undefined => process.env[name];

const required = (name: string): string => {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  }
  return value;
};

const csv = (name: string): string[] =>
  (env(name) ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);

const googleClientId = env('GOOGLE_CLIENT_ID');
const googleClientSecret = env('GOOGLE_CLIENT_SECRET');

/** Where the user lands after Better Auth has finished with the token in the link. */
const dashboardUrl = (): string => env('DASHBOARD_URL') ?? 'http://localhost:4300';

/**
 * Points a Better Auth link at a page of ours once its token has been consumed.
 *
 * The URL Better Auth builds calls back to the API, whose default landing page is the
 * API itself — a user who clicks "verify" would end up looking at JSON. Only the
 * callback is rewritten; the token and the path stay exactly as issued.
 */
const withCallback = (rawUrl: string, target: string): string => {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('callbackURL', target);
    return url.toString();
  } catch {
    return rawUrl;
  }
};

/**
 * The Better Auth instance.
 *
 * This is deliberately a module-scope singleton rather than a Nest provider: the
 * Better Auth CLI imports this file directly to generate the Drizzle schema
 * (`pnpm auth:generate`), and it has no access to the Nest DI container.
 *
 * Owned tables (user, session, account, verification, organization, member,
 * invitation, team, teamMember, organizationRole, twoFactor) are generated into
 * `packages/db/src/schema/auth.schema.ts`. That file is NEVER hand-edited — it is
 * regenerated on every Better Auth upgrade and reviewed like any other diff.
 */
const stripePlugin = createStripePlugin();

/**
 * The platform roles, declared to Better Auth's admin plugin.
 *
 * It only accepts `adminRoles` it knows, and it ships with `admin` and `user` only —
 * so `superadmin` has to be defined here or every call it makes would be refused as
 * coming from a non-admin. It gets every statement, including `impersonate-admins`,
 * which `adminAc` deliberately lacks: a support admin who can become another admin can
 * do anything that admin can, while the audit trail names the wrong person.
 *
 * This is Better Auth's own catalogue, not ours. Ours lives in
 * packages/contracts/src/common/permissions.ts and is stricter — both run, in that
 * order.
 */
const platformRoles = {
  user: userAc,
  admin: adminAc,
  superadmin: defaultAc.newRole(defaultStatements),
};

export const auth = betterAuth({
  appName: env('APP_NAME') ?? 'saas-template',
  secret: required('BETTER_AUTH_SECRET'),
  baseURL: required('BETTER_AUTH_URL'),
  basePath: '/api/auth',
  trustedOrigins: csv('AUTH_TRUSTED_ORIGINS'),

  database: drizzleAdapter(db, {
    provider: 'pg',
    schema,
  }),

  /**
   * In `b2c`, every new account gets the organization its data lives in, without ever
   * being asked about it — see personal-organization.ts. In `b2b` the hook is a no-op
   * and the user creates one explicitly.
   *
   * On `create.after` rather than `before`: the user row has to exist before a member
   * row can reference it.
   */
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await ensurePersonalOrganization(user);
        },
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    /**
     * Off by default so a fresh clone is usable immediately; the configuration
     * validation refuses to start in production with it off. See
     * AUTH_REQUIRE_EMAIL_VERIFICATION in env.schema.ts.
     */
    requireEmailVerification: env('AUTH_REQUIRE_EMAIL_VERIFICATION') === 'true',
    minPasswordLength: 12,

    sendResetPassword: async ({ user, url }) => {
      await authMailer().send({
        to: user.email,
        template: 'password-reset',
        /**
         * The callback is the page where the new password is typed, not the login
         * form: Better Auth's link hits the API, which validates the token and then
         * redirects to this URL with `?token=` appended. Pointing it at /sign-in would
         * drop the token on a page that has no use for it.
         */
        params: {
          name: user.name ?? '',
          url: withCallback(url, `${dashboardUrl()}/reset-password`),
        },
        userId: user.id,
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,
    // Clicking the link signs you in, rather than dropping you on a login form seconds
    // after you proved you own the address.
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await authMailer().send({
        to: user.email,
        template: 'email-verification',
        params: { name: user.name ?? '', url: withCallback(url, `${dashboardUrl()}/dashboard`) },
        userId: user.id,
      });
    },
  },

  socialProviders:
    googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {},

  session: {
    // 7 days, not the 30-day token the previous template shipped.
    expiresIn: Number(env('SESSION_EXPIRES_IN') ?? 60 * 60 * 24 * 7),
    updateAge: Number(env('SESSION_UPDATE_AGE') ?? 60 * 60 * 24),
  },

  advanced: {
    // Cookies are read by two different Angular origins in development, so the domain
    // has to be explicit in production and absent locally.
    ...(env('COOKIE_DOMAIN')
      ? { crossSubDomainCookies: { enabled: true, domain: env('COOKIE_DOMAIN') as string } }
      : {}),
  },

  plugins: [
    // Organizations are the tenancy boundary: subscriptions and every domain table
    // hang off organization.id, never off user.id.
    //
    // Sub-teams (`teams: { enabled: true }`) and per-organization custom roles
    // (`dynamicAccessControl: { enabled: true }`) are deliberately OFF. Enabling them
    // creates the team/teamMember/organizationRole tables and changes how invitations
    // and member queries behave, for features v1 does not use. Turning either on later
    // is one `pnpm auth:generate` plus one migration — see CLAUDE.md.
    organization({
      // Whoever creates the organization owns it.
      creatorRole: env('ORG_CREATOR_ROLE') ?? 'owner',

      sendInvitationEmail: async (data) => {
        await authMailer().send({
          to: data.email,
          template: 'organization-invitation',
          params: {
            organizationName: data.organization.name,
            inviterName: data.inviter.user.name ?? '',
            role: String(data.role),
            // The accept screen itself arrives with the members feature; the link is
            // built now so the invitation is a complete, testable round trip.
            url: `${dashboardUrl()}/accept-invitation?id=${encodeURIComponent(data.id)}`,
          },
          organizationId: data.organization.id,
        });
      },
    }),
    // Platform-level roles, user banning and support impersonation.
    admin({
      // The role every new account starts with. Least privilege by default: the
      // permission catalogue gives 'user' no platform rights at all, so promoting
      // someone has to be an explicit act.
      defaultRole: env('AUTH_DEFAULT_ROLE') ?? 'user',
      roles: platformRoles,
      adminRoles: ['admin', 'superadmin'],
    }),
    // TOTP + backup codes.
    twoFactor(),

    // Billing, when Stripe is configured. Absent locally without keys, so the rest of
    // the application stays usable without a Stripe account; production config
    // validation refuses to start without them.
    ...(stripePlugin ? [stripePlugin] : []),
  ],
});

export type Auth = typeof auth;
