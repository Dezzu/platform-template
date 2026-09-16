/**
 * Idempotent development seed.
 *
 * Safe to run repeatedly: every statement upserts. It seeds only the global catalogue
 * tables — demo organizations and users are seeded once the auth tables exist.
 */
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createDatabase } from './client';
import { appSetting, featureFlag, plan } from './schema';

loadEnv({ path: resolve(__dirname, '../../../.env'), quiet: true });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env first.');
}

const PLANS = [
  {
    key: 'free',
    nameKey: 'plans.free.name',
    descriptionKey: 'plans.free.description',
    amountMonthly: 0,
    amountYearly: 0,
    limits: { members: 2, storageMb: 100, projects: 3 },
    features: ['plans.features.basic', 'plans.features.community_support'],
    sortOrder: 10,
    isDefault: true,
  },
  {
    key: 'pro',
    nameKey: 'plans.pro.name',
    descriptionKey: 'plans.pro.description',
    amountMonthly: 1900,
    amountYearly: 19000,
    limits: { members: 10, storageMb: 10_240, projects: 50 },
    features: ['plans.features.everything_free', 'plans.features.email_support'],
    sortOrder: 20,
    isDefault: false,
  },
  {
    key: 'business',
    nameKey: 'plans.business.name',
    descriptionKey: 'plans.business.description',
    amountMonthly: 4900,
    amountYearly: 49000,
    limits: { members: 100, storageMb: 102_400, projects: -1 },
    features: ['plans.features.everything_pro', 'plans.features.priority_support'],
    sortOrder: 30,
    isDefault: false,
  },
] as const;

const FEATURE_FLAGS = [
  { key: 'billing.enabled', description: 'Stripe checkout and customer portal', enabled: true },
  { key: 'organizations.teams', description: 'Sub-teams inside an organization', enabled: false },
  { key: 'notifications.inApp', description: 'In-app notification centre', enabled: true },
] as const;

async function main(): Promise<void> {
  const { db, pool } = createDatabase({ url: DATABASE_URL as string });

  try {
    for (const p of PLANS) {
      await db
        .insert(plan)
        .values({ ...p, currency: 'EUR', isActive: true })
        .onConflictDoUpdate({
          target: plan.key,
          set: {
            nameKey: p.nameKey,
            descriptionKey: p.descriptionKey,
            amountMonthly: p.amountMonthly,
            amountYearly: p.amountYearly,
            limits: p.limits,
            features: p.features,
            sortOrder: p.sortOrder,
            isDefault: p.isDefault,
            updatedAt: new Date(),
          },
        });
    }
    console.warn(`seeded ${PLANS.length} plans`);

    for (const f of FEATURE_FLAGS) {
      await db
        .insert(featureFlag)
        .values(f)
        .onConflictDoUpdate({
          target: featureFlag.key,
          set: { description: f.description, updatedAt: new Date() },
        });
    }
    console.warn(`seeded ${FEATURE_FLAGS.length} feature flags`);

    await db
      .insert(appSetting)
      .values({
        key: 'maintenance_mode',
        value: { enabled: false, messageKey: null, allowRoles: ['superadmin'], until: null },
      })
      .onConflictDoNothing({ target: appSetting.key });
    console.warn('seeded app settings');
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('seed failed:', error);
  process.exit(1);
});
