import 'reflect-metadata';
import { Logger, StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
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
  app.useGlobalInterceptors(new RequestContextInterceptor(), new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AppExceptionFilter(process.env['NODE_ENV'] === 'production'));

  setupOpenApi(app);

  app.enableShutdownHooks();

  const port = Number(process.env['APP_PORT'] ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}

void bootstrap();
