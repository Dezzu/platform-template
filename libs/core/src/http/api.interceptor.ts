import { inject } from '@angular/core';
import { type HttpErrorResponse, type HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { catchError, map, throwError } from 'rxjs';
import type { BaseResponse, ErrorCode } from '@app/contracts';
import { CORE_CONFIG } from '../config/core.config';
import { AppError } from './app-error';

/**
 * Unwraps the response envelope and normalises failures.
 *
 * Every API response is `{ success, message, messageCode, data }`. Unwrapping it here
 * means no service or component ever writes `.data`, and a shape change is one edit.
 *
 * Better Auth's own routes are skipped: they have their own response shape, and the
 * Better Auth client parses them.
 */
export const apiInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(CORE_CONFIG);
  const router = inject(Router);

  const isApiCall = request.url.startsWith(config.apiUrl);
  const isAuthCall = request.url.startsWith(config.authUrl);

  if (!isApiCall || isAuthCall) return next(request);

  // The session is an httpOnly cookie, so it only travels with credentials enabled.
  const authorized = request.clone({ withCredentials: true });

  return next(authorized).pipe(
    map((event) => {
      if (!(event instanceof HttpResponse)) return event;
      const body = event.body as BaseResponse<unknown> | null;
      if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
        return event.clone({ body: body.data });
      }
      return event;
    }),
    catchError((error: unknown) => {
      const normalized = normalize(error);

      // A session that expired mid-use should land on the login page rather than
      // leave the user clicking on an application that answers 401 to everything.
      if (normalized.status === 401) {
        void router.navigateByUrl(config.loginRoute);
      }

      /**
       * The product is closed and this visitor is not on the allow list. Every request
       * they make will answer the same way, so showing the notice once beats an
       * application that reports a different failure on each screen.
       *
       * Only when a route is configured: an application without a maintenance screen
       * keeps the error and lets the caller decide what to render.
       */
      if (normalized.status === 503 && normalized.code === 'MAINTENANCE_MODE') {
        const route = config.maintenanceRoute;
        if (route) void router.navigateByUrl(route);
      }

      return throwError(() => normalized);
    }),
  );
};

function normalize(error: unknown): AppError {
  const response = error as HttpErrorResponse;

  // status 0 means the request never reached the server: offline, DNS, CORS.
  if (response?.status === 0) {
    return new AppError(0, 'NETWORK_ERROR', 'The server is unreachable');
  }

  const body = response?.error as (BaseResponse<null> & { details?: unknown }) | undefined;
  if (body && typeof body === 'object' && 'messageCode' in body) {
    return new AppError(
      response.status,
      (body.messageCode ?? 'INTERNAL_ERROR') as ErrorCode,
      body.message ?? 'Request failed',
      body.details,
    );
  }

  return new AppError(
    response?.status ?? 500,
    'INTERNAL_ERROR',
    response?.message ?? 'Request failed',
  );
}
