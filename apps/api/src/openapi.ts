import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { env } from './config/validate-env';

/**
 * Publishes the OpenAPI document at /api/docs.
 *
 * Schemas come straight from the Zod contracts in packages/contracts via Swagger 12's
 * Standard Schema support, so the documentation cannot drift from what the server
 * actually validates.
 *
 * Not mounted in production: the document is a complete map of the API surface.
 * Generate the client from it in CI instead.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = env();
  if (config.NODE_ENV === 'production') return;

  const builder = new DocumentBuilder()
    .setTitle(`${config.APP_NAME} API`)
    .setDescription(
      'Every response is wrapped in the shared envelope ' +
        '`{ success, message, messageCode, data }`. Errors keep their real HTTP status ' +
        'and carry a stable `messageCode` that the frontend translates as `errors.<CODE>`.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('better-auth.session_token', {
      type: 'apiKey',
      in: 'cookie',
      description: 'Session cookie issued by Better Auth at /api/auth/sign-in/email',
    })
    .build();

  const document = SwaggerModule.createDocument(app, builder);

  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/json',
    swaggerOptions: { persistAuthorization: true },
  });
}
