import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '@thallesp/nestjs-better-auth';
import { auth } from './auth/auth.config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { MeModule } from './modules/me/me.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [resolve(__dirname, '../../../.env')],
      cache: true,
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
    }),

    HealthModule,
    MeModule,
  ],
})
export class AppModule {}
