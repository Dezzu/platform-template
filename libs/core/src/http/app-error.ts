import type { ErrorCode } from '@app/contracts';

/**
 * A failure from the API, already normalised.
 *
 * `code` is the whole point: the UI translates `errors.${code}` and never displays
 * `message`, which is English developer text. Anything the client should render
 * precisely — the list of missing permissions, the offending fields — arrives in
 * `details`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }

  /** i18n key for this failure. */
  get translationKey(): string {
    return `errors.${this.code}`;
  }
}
