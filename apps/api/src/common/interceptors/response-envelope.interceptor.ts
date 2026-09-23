import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { BaseResponse } from '@app/contracts';
import { type Observable, map } from 'rxjs';
import { RAW_RESPONSE_METADATA } from './raw-response.decorator';

/**
 * Wraps every successful controller response in the shared envelope.
 *
 * The Better Auth routes are served by middleware mounted ahead of the Nest router,
 * so they never reach this interceptor and keep their own response shape — which is
 * what the Better Auth client on the frontend expects.
 *
 * `@RawResponse()` opts a handler out, and there is exactly one kind that needs to:
 * an SSE stream, whose Observable emits once per event rather than once per request.
 * Wrapping those would envelope every event and lose the `type` that tells
 * `EventSource` which listener each one belongs to.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, BaseResponse<T> | T> {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<BaseResponse<T> | T> {
    const raw = this.reflector.getAllAndOverride<boolean | undefined>(RAW_RESPONSE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) return next.handle();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        message: null,
        messageCode: null,
        data: data ?? null,
      })),
    );
  }
}
