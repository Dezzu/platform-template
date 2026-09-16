import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, type ErrorCode } from '@app/contracts';

/**
 * The only exception type application code should throw.
 *
 * It carries a stable `code` that the frontend translates (`errors.<CODE>`), so the
 * HTTP layer never needs to produce a user-facing sentence. `details` is optional
 * structured data the client can use to render something precise — for example the
 * list of permissions that were missing.
 */
export class AppException extends HttpException {
  constructor(
    readonly code: ErrorCode,
    status: HttpStatus,
    message: string,
    readonly details?: unknown,
  ) {
    super(message, status);
  }

  static notFound(resource: string, code: ErrorCode = ERROR_CODES.NOT_FOUND): AppException {
    return new AppException(code, HttpStatus.NOT_FOUND, `${resource} not found`);
  }

  static forbidden(message = 'Forbidden', details?: unknown): AppException {
    return new AppException(ERROR_CODES.FORBIDDEN, HttpStatus.FORBIDDEN, message, details);
  }

  static missingPermission(missing: readonly string[]): AppException {
    return new AppException(
      ERROR_CODES.FORBIDDEN_MISSING_PERMISSION,
      HttpStatus.FORBIDDEN,
      `Missing required permission(s): ${missing.join(', ')}`,
      { missing },
    );
  }

  static conflict(message: string, code: ErrorCode = ERROR_CODES.CONFLICT): AppException {
    return new AppException(code, HttpStatus.CONFLICT, message);
  }

  static validation(message = 'Validation failed', details?: unknown): AppException {
    return new AppException(
      ERROR_CODES.VALIDATION_FAILED,
      HttpStatus.UNPROCESSABLE_ENTITY,
      message,
      details,
    );
  }
}
