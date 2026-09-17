import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, organization, twoFactor } from 'better-auth/plugins';
import { createStripePlugin } from '../modules/billing/stripe-plugin';
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

  emailAndPassword: {
    enabled: true,
    // Flipped on in Phase 8, once the mail transport exists. Leaving it on now would
    // make every signup unusable in local development.
    requireEmailVerification: false,
    minPasswordLength: 12,
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
    }),
    // Platform-level roles, user banning and support impersonation.
    admin({
      // The role every new account starts with. Least privilege by default: the
      // permission catalogue gives 'user' no platform rights at all, so promoting
      // someone has to be an explicit act.
      defaultRole: env('AUTH_DEFAULT_ROLE') ?? 'user',
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
