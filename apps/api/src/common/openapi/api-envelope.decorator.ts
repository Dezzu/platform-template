import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import { zBaseResponse } from '@app/contracts';
import { z } from 'zod';

interface ApiEnvelopeOptions {
  status?: HttpStatus;
  description?: string;
  isArray?: boolean;
}

/**
 * Documents a response as the shared envelope wrapping the given payload schema.
 *
 * Because every response is wrapped by ResponseEnvelopeInterceptor, documenting the
 * bare payload would be a lie — the generated client would not match what the server
 * actually sends. This decorator keeps the two honest.
 *
 * Swagger 12 accepts a Standard Schema directly, so the Zod schema from
 * packages/contracts is the single source for validation, types and OpenAPI.
 */
export function ApiEnvelope<T extends z.ZodType>(
  payload: T,
  options: ApiEnvelopeOptions = {},
): MethodDecorator & ClassDecorator {
  const data = options.isArray ? z.array(payload) : payload;

  return applyDecorators(
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description ?? 'Success',
      standardSchema: zBaseResponse(data),
    }),
  );
}

/**
 * The error responses every authenticated endpoint can return. Documented once here
 * rather than repeated on each route — and they all carry a `messageCode` the client
 * translates.
 */
export function ApiStandardErrors(): MethodDecorator & ClassDecorator {
  const envelope = zBaseResponse(z.null());
  return applyDecorators(
    ApiResponse({
      status: HttpStatus.UNAUTHORIZED,
      description: 'No valid session (messageCode: UNAUTHENTICATED)',
      standardSchema: envelope,
    }),
    ApiResponse({
      status: HttpStatus.FORBIDDEN,
      description: 'Missing permission (messageCode: FORBIDDEN_MISSING_PERMISSION)',
      standardSchema: envelope,
    }),
    ApiResponse({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      description: 'Validation failed (messageCode: VALIDATION_FAILED)',
      standardSchema: envelope,
    }),
  );
}
