import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { newRequestId, runWithRequestContext, type RequestContext } from '../request-context';

/**
 * Opens an AsyncLocalStorage scope for the request so anything downstream can read
 * its origin without being handed it explicitly.
 *
 * An inbound X-Request-Id is honoured so a request can be followed across the reverse
 * proxy and the frontend; otherwise one is generated. It is echoed back on the
 * response, which makes "send me the request id" a useful thing to ask a user.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const inbound = request.headers['x-request-id'];
    const requestId = (Array.isArray(inbound) ? inbound[0] : inbound) || newRequestId();

    const ctx: RequestContext = {
      requestId,
      // `req.ip` respects Express' trust proxy setting, which is what we want behind
      // nginx; it falls back to the socket address when no proxy is configured.
      ip: request.ip ?? null,
      userAgent: request.headers['user-agent'] ?? null,
      traceId: null,
    };

    response.setHeader('X-Request-Id', requestId);

    return runWithRequestContext(ctx, () => next.handle());
  }
}
