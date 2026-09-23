import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { context as otelContext, trace } from '@opentelemetry/api';
import type { Observable } from 'rxjs';
import { ORG_CONTEXT_KEY, type OrgContext } from '../auth/org-context';
import { currentRequestContext } from '../common/request-context';

interface RequestWithContext extends Record<string, unknown> {
  session?: { user?: { id: string; role?: string | null } };
}

/**
 * Marks the request's span with who it was for.
 *
 * The auto-instrumentation gives a span per request with the method, the route and the
 * status — enough to see that something is slow, never enough to see *for whom*. These
 * four attributes are what turn a trace search into an answer: "show me this customer's
 * requests", "show me what this person did", "here is the trace for the request id in
 * their support ticket".
 *
 * Runs as an interceptor rather than a middleware because that is the first point at
 * which the tenant exists: `PermissionsGuard` resolves it, and guards run before
 * interceptors.
 *
 * Dotted, lowercase names on purpose — that is the OpenTelemetry convention, and a
 * backend that groups by attribute prefix can then group `org.*` together.
 */
@Injectable()
export class TelemetryInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const span = trace.getSpan(otelContext.active());

    // No span means telemetry is off. Everything below would be a no-op anyway, and
    // this keeps the cost of the disabled path at one property read.
    if (!span) return next.handle();

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const org = request[ORG_CONTEXT_KEY] as OrgContext | undefined;

    const userId = org?.userId ?? request.session?.user?.id;
    if (userId) span.setAttribute('user.id', userId);

    if (org) {
      span.setAttribute('org.id', org.organizationId);
      span.setAttribute('org.role', org.role);
      /**
       * Recorded separately from `user.id`, which stays the person being acted as.
       * Without this an administrator's actions while impersonating are attributed to
       * the customer, which is exactly backwards for the one case where it matters.
       */
      if (org.impersonatorUserId) span.setAttribute('user.impersonator_id', org.impersonatorUserId);
    }

    const requestId = currentRequestContext()?.requestId;
    if (requestId) span.setAttribute('request.id', requestId);

    return next.handle();
  }
}
