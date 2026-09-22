import { Logger, StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import {
  AppException,
  AppExceptionFilter,
  RequestContextInterceptor,
  ResponseEnvelopeInterceptor,
} from '../src/common';

/**
 * Boots the real application the same way main.ts does.
 *
 * The global pipe/filter/interceptor wiring is duplicated here on purpose: these tests
 * exist to prove that wiring behaves, so importing a helper that main.ts also used
 * would let a bug hide in the shared helper. If you change main.ts, change this too —
 * the e2e specs will fail loudly if you forget.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  Logger.overrideLogger(false);

  // Mirrors main.ts: without it the specs would hit paths that do not exist in the
  // running application.
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready', 'health/info'] });

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
  app.useGlobalInterceptors(new RequestContextInterceptor(), new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AppExceptionFilter(false));

  /**
   * Listening, not merely initialised — and this is what keeps the suite stable.
   *
   * `request(app.getHttpServer())` manages the server's lifecycle when it finds it
   * closed: supertest calls `listen(0)` before the request and `close()` after. With
   * only `init()` that happened for EVERY request, hundreds of times per run, each on
   * a fresh ephemeral port. Two things fell out of that churn, both of them damage at
   * the HTTP layer rather than in the logic under test:
   *
   *  - a pooled socket aimed at a port the operating system had since recycled, which
   *    surfaced as `Parse Error: Expected HTTP/…` or as a request landing on an
   *    application that did not have that route (a 404 where the route exists);
   *  - a `close()` racing a request still in flight, which surfaced as `ECONNRESET`.
   *
   * Listening once per spec file removes the churn: supertest finds the server up and
   * leaves it alone, and `app.close()` in `afterAll` takes it down once.
   */
  await app.init();
  await app.listen(0);
  return app;
}
