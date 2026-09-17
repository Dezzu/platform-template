import { HttpStatus } from '@nestjs/common';
import { APIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import { ERROR_CODES, type ErrorCode } from '@app/contracts';
import { AppException } from '../common';

/** Anything with Node's incoming headers on it. Express's Request satisfies it. */
interface HasNodeHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Turns Express's header bag into the `Headers` object Better Auth expects.
 *
 * Passing the caller's own headers is what makes a server-side call act *as* the
 * caller: Better Auth resolves the session from the cookie and applies its own checks,
 * on top of ours. Never synthesise these — a call that authenticates as nobody in
 * particular is a call with no authorisation at all.
 */
export function authHeaders(request: HasNodeHeaders): Headers {
  return fromNodeHeaders(request.headers);
}

/**
 * Better Auth's error codes, mapped onto ours.
 *
 * The translation exists because the frontend renders `errors.<CODE>` from our
 * catalogue. Letting a library's code reach the client would mean either an untranslated
 * string on screen, or a second catalogue to keep in step with somebody else's releases.
 */
const CODE_MAP: Record<string, { code: ErrorCode; status: number }> = {
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: {
    code: ERROR_CODES.MEMBER_ALREADY_EXISTS,
    status: HttpStatus.CONFLICT,
  },
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: {
    code: ERROR_CODES.INVITATION_ALREADY_SENT,
    status: HttpStatus.CONFLICT,
  },
  INVITATION_NOT_FOUND: { code: ERROR_CODES.INVITATION_NOT_FOUND, status: HttpStatus.NOT_FOUND },
  INVITATION_HAS_EXPIRED: { code: ERROR_CODES.INVITATION_EXPIRED, status: HttpStatus.GONE },
  MEMBER_NOT_FOUND: { code: ERROR_CODES.NOT_FOUND, status: HttpStatus.NOT_FOUND },
  ORGANIZATION_NOT_FOUND: {
    code: ERROR_CODES.ORGANIZATION_NOT_FOUND,
    status: HttpStatus.NOT_FOUND,
  },
  ROLE_NOT_FOUND: { code: ERROR_CODES.VALIDATION_FAILED, status: HttpStatus.UNPROCESSABLE_ENTITY },
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_AS_THE_ONLY_OWNER: {
    code: ERROR_CODES.ORGANIZATION_LAST_OWNER,
    status: HttpStatus.CONFLICT,
  },
  YOU_CANNOT_LEAVE_THE_ORGANIZATION_WITHOUT_AN_OWNER: {
    code: ERROR_CODES.ORGANIZATION_LAST_OWNER,
    status: HttpStatus.CONFLICT,
  },
  USER_NOT_FOUND: { code: ERROR_CODES.NOT_FOUND, status: HttpStatus.NOT_FOUND },
};

/**
 * Runs a Better Auth server call and rethrows its failures as ours.
 *
 * Without this the exception filter sees an unknown error type and answers 500, which
 * would turn "you already invited this person" into "something went wrong".
 */
export async function callAuthApi<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    throw translateAuthError(error);
  }
}

export function translateAuthError(error: unknown): unknown {
  if (!(error instanceof APIError)) return error;

  const code = typeof error.body?.code === 'string' ? error.body.code : undefined;
  const mapped = code ? CODE_MAP[code] : undefined;
  const message = error.body?.message ?? error.message;

  if (mapped) return new AppException(mapped.code, mapped.status, message);

  // Unmapped, but still a deliberate refusal from the library rather than a crash:
  // keep its status and say so honestly instead of dressing it up as a 500.
  const status = error.statusCode || HttpStatus.BAD_REQUEST;
  const fallback: ErrorCode =
    status === HttpStatus.FORBIDDEN
      ? ERROR_CODES.FORBIDDEN
      : status === HttpStatus.NOT_FOUND
        ? ERROR_CODES.NOT_FOUND
        : status === HttpStatus.UNAUTHORIZED
          ? ERROR_CODES.UNAUTHENTICATED
          : ERROR_CODES.VALIDATION_FAILED;

  return new AppException(fallback, status, message);
}
