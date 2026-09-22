import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_METADATA = Symbol('app:feature-flag');

/**
 * Refuses the route with 403 FEATURE_DISABLED while the flag is off for the caller.
 *
 *   @RequireFeature('organizations.teams')
 *
 * The point of having this on the backend at all: hiding a menu entry hides the
 * feature from the reader, not from anyone who types the URL or calls the API. A flag
 * that only exists in the browser is a suggestion.
 */
export const RequireFeature = (key: string): MethodDecorator & ClassDecorator =>
  SetMetadata(FEATURE_FLAG_METADATA, key);
