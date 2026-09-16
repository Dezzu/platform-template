import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AuthGuard, AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.config';
import { configNamespaces } from './config/namespaces';
import { validateEnv } from './config/validate-env';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { MeModule } from './modules/me/me.module';
import { PlansModule } from './modules/plans/plans.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { AuditModule } from './modules/audit/audit.module';
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
    ProjectsModule,
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
     * 2. PermissionsGuard — resolves the tenant and enforces @RequirePermissions()
     *                       (403), and is inert on routes that declare none.
     */
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
