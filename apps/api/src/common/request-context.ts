import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/**
 * Per-request metadata that almost everything wants but nothing should have to thread
 * through its call signatures: the client IP, the user agent, a request id, and later
 * the trace id.
 *
 * Without this, `auditService.record()` would need ip/userAgent passed down from the
 * controller through every service layer, and the first person to forget would produce
 * audit entries with no origin — exactly when you need them.
 */
export interface RequestContext {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
  traceId: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** Returns the current context, or null outside a request (jobs, startup, tests). */
export function currentRequestContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

export function newRequestId(): string {
  return randomUUID();
}
