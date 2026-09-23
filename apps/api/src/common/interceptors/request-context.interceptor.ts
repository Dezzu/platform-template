import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { context as otelContext, trace } from '@opentelemetry/api';
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
 *
 * It also captures the trace id, which is what makes an `audit_log` row clickable
 * through to the trace that produced it.
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
      /**
       * The trace this request belongs to, so an audit entry links to Tempo.
       *
       * Read from the ambient OpenTelemetry context: the HTTP auto-instrumentation has
       * already opened the server span by the time an interceptor runs. Null when
       * telemetry is switched off, which is the normal case locally — the column has
       * always allowed it.
       */
      traceId: trace.getSpan(otelContext.active())?.spanContext().traceId ?? null,
    };

    response.setHeader('X-Request-Id', requestId);

    return runWithRequestContext(ctx, () => next.handle());
  }
}
