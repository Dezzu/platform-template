import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppExceptionFilter, ResponseEnvelopeInterceptor } from './common';

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

  // Applied globally so no controller can forget them: every success is wrapped in
  // the envelope, every failure becomes an envelope with a translatable messageCode
  // while keeping its real HTTP status.
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AppExceptionFilter(process.env['NODE_ENV'] === 'production'));

  app.enableShutdownHooks();

  const port = Number(process.env['APP_PORT'] ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API listening on http://localhost:${port}`);
}

void bootstrap();
