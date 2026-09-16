import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { BaseResponse } from '@app/contracts';
import { type Observable, map } from 'rxjs';

/**
 * Wraps every successful controller response in the shared envelope.
 *
 * The Better Auth routes are served by middleware mounted ahead of the Nest router,
 * so they never reach this interceptor and keep their own response shape — which is
 * what the Better Auth client on the frontend expects.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<T, BaseResponse<T>> {
  intercept(_context: ExecutionContext, next: CallHandler<T>): Observable<BaseResponse<T>> {
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
