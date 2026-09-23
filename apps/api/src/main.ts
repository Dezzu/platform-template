import 'reflect-metadata';
import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module';
import { appConfig } from './config/namespaces';
import { createLogger, PinoLoggerService } from './observability/logger';
import { TelemetryInterceptor } from './observability/telemetry.interceptor';
import {
  AppException,
  AppExceptionFilter,
  RequestContextInterceptor,
  ResponseEnvelopeInterceptor,
} from './common';
import { setupOpenApi } from './openapi';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    /**
     * Required by @thallesp/nestjs-better-auth: Better Auth needs the unparsed request
     * stream. The library re-registers json/urlencoded parsers itself (and attaches
     * req.rawBody) via AuthModule.forRoot({ bodyParser: ... }) in app.module.ts.
     *
     * Do not "fix" this by removing it — the auth routes will start failing in ways
     * that look like CORS or cookie problems rather than body-parsing problems.
     */
    bodyParser: false,

    /**
     * Held, not dropped. Nest logs the modules it initialises and the routes it maps
     * before there is any chance to install a logger, and those lines are the ones you
     * want when a boot goes wrong. Buffered, they are replayed through pino below —
     * structured, and carrying the trace ids like everything else.
     */
    bufferLogs: true,
  });

  /**
   * The real logger, built from validated configuration rather than from `process.env`.
   *
   * It can only happen here: the configuration does not exist until the container is
   * up, and the logger has to exist before the buffered lines are flushed.
   */
  const config = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  app.useLogger(
    new PinoLoggerService(
      createLogger({
        level: config.logLevel,
        pretty: config.logFormat === 'pretty',
        serviceName: config.name,
      }),
    ),
  );

  /**
   * Every controller lives under /api, which is what the frontends and the nginx
   * proxy expect. Better Auth is mounted as middleware on its own basePath
   * (/api/auth) and is unaffected by this.
   *
   * Health is excluded on purpose: container health checks and the post-deploy smoke
   * test should not have to know about the API's prefix, and keeping the probes at
   * the root means they survive a change to it.
   */
  app.setGlobalPrefix('api', {
    exclude: ['health/live', 'health/ready', 'health/info'],
  });

  // Never "*". The previous template allowed every origin on every route.
  const origins = (process.env['AUTH_TRUSTED_ORIGINS'] ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  /**
   * Enforces the schemas declared in `@Body({ schema })` / `@Query({ schema })`.
   *
   * This pipe is NOT optional: the decorator only attaches the schema as parameter
   * metadata, and without a pipe to consume it the schema documents OpenAPI while
   * validating nothing — invalid payloads reach the database silently. Registering it
   * globally means no endpoint can forget it.
   *
   * Validation failures become 422 (not the pipe's default 400) carrying
   * messageCode VALIDATION_FAILED and the offending field paths.
   */
  app.useGlobalPipes(
    new StandardSchemaValidationPipe({
      transform: true,
      exceptionFactory: (issues) =>
        AppException.validation(
          'Validation failed',
          issues.map((issue) => ({
            path: (issue.path ?? [])
              .map((segment) =>
                typeof segment === 'object' && segment !== null && 'key' in segment
                  ? String((segment as { key: PropertyKey }).key)
                  : String(segment),
              )
              .join('.'),
            message: issue.message,
          })),
        ),
    }),
  );

  // Applied globally so no controller can forget them: every success is wrapped in
  // the envelope, every failure becomes an envelope with a translatable messageCode
  // while keeping its real HTTP status.
  // Order matters: the request context must be open before anything else runs.
  app.useGlobalInterceptors(
    new RequestContextInterceptor(),
    // After the request context, because it reads the request id from it; before the
    // envelope, which only shapes what comes back.
    new TelemetryInterceptor(),
    new ResponseEnvelopeInterceptor(),
  );
  app.useGlobalFilters(new AppExceptionFilter(process.env['NODE_ENV'] === 'production'));

  setupOpenApi(app);

  app.enableShutdownHooks();

  const port = Number(process.env['APP_PORT'] ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}

void bootstrap();
