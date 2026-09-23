import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard, AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.config';
import { configNamespaces } from './config/namespaces';
import { validateEnv } from './config/validate-env';
import { DatabaseModule } from './database/database.module';
import { ObservabilityModule } from './observability/observability.module';
import { QueueModule } from './queue/queue.module';
import { StorageModule } from './storage/storage.module';
import { HealthModule } from './modules/health/health.module';
import { MeModule } from './modules/me/me.module';
import { PlansModule } from './modules/plans/plans.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AuditModule } from './modules/audit/audit.module';
import { BillingModule } from './modules/billing/billing.module';
import { SubscriptionGuard } from './modules/billing/subscription.guard';
import { InsightsModule } from './modules/insights/insights.module';
import { FilesModule } from './modules/files/files.module';
import { MembersModule } from './modules/members/members.module';
import { AdminModule } from './modules/admin/admin.module';
import { FlagsModule } from './modules/flags/flags.module';
import { FeatureGuard } from './modules/flags/feature.guard';
import { MailModule } from './modules/mail/mail.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { GdprModule } from './modules/gdpr/gdpr.module';
import { MaintenanceModule } from './modules/maintenance/maintenance.module';
import { MaintenanceGuard } from './modules/maintenance/maintenance.guard';
import { PermissionsGuard } from './auth/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(__dirname, '../../../.env')],
      cache: true,
      // Validates the whole environment up front and exits listing every problem
      // rather than failing later on the first missing variable.
      validate: validateEnv,
      load: configNamespaces,
    }),

    DatabaseModule,
    QueueModule,
    StorageModule,
    ObservabilityModule,

    /**
     * Before AuthModule on purpose. Better Auth's hooks send verification, reset and
     * invitation emails through MailService, reached via mail.bridge.ts — and that
     * bridge is populated by MailModule's constructor, which must therefore have run.
     */
    MailModule,

    /**
     * Registers the Better Auth handler at /api/auth/* and a GLOBAL AuthGuard:
     * every route is authenticated unless it opts out with @AllowAnonymous() or
     * @OptionalAuth(). Secure by default — a forgotten decorator returns 401 rather
     * than silently exposing an endpoint.
     *
     * `bodyParser.rawBody` is what makes Stripe webhook signature verification
     * possible. This library disables Nest's built-in body parser (which is why
     * main.ts passes `bodyParser: false`), so Nest's own `rawBody: true` option has
     * no effect and this is the only switch that works.
     */
    AuthModule.forRoot({
      auth,
      bodyParser: { rawBody: true },
      isGlobal: true,
      // Its own global guard is disabled so the order of the chain is ours to state
      // explicitly below, instead of depending on the order Nest happens to discover
      // APP_GUARD providers in.
      disableGlobalAuthGuard: true,
    }),

    HealthModule,
    MeModule,
    PlansModule,
    AuditModule,
    BillingModule,
    ProjectsModule,
    InsightsModule,
    FilesModule,
    MembersModule,
    AdminModule,
    FlagsModule,
    NotificationsModule,
    GdprModule,
    MaintenanceModule,
  ],
  providers: [
    /**
     * The guard chain, in order. APP_GUARD providers run in registration order, so
     * stating both here is what guarantees authentication happens before
     * authorization — PermissionsGuard reads `request.session`, which AuthGuard is
     * what populates.
     *
     * 1. AuthGuard        — is there a session? (401) Every route is protected unless
     *                       it opts out with @AllowAnonymous() / @OptionalAuth().
     * 2. MaintenanceGuard — is the product open? (503) After authentication because
     *                       the answer depends on `user.role`: running it first would
     *                       mean locking out the administrator who has to switch it
     *                       back off along with everybody else.
     * 3. PermissionsGuard — resolves the tenant and enforces @RequirePermissions()
     *                       (403), and is inert on routes that declare none.
     * 4. FeatureGuard     — enforces @RequireFeature() (403 FEATURE_DISABLED). After
     *                       the tenant is resolved, because an organization override
     *                       is the level most rollouts actually use.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: MaintenanceGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },
    /**
     * 5. SubscriptionGuard — the paywall (402). Last, because it relies on the tenant
     *    PermissionsGuard resolved: a paywall that had to work out which organization
     *    it was talking about would be a second place to get tenancy wrong.
     */
    { provide: APP_GUARD, useClass: SubscriptionGuard },
  ],
})
export class AppModule {}
