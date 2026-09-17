import { SetMetadata } from '@nestjs/common';

export const REQUIRES_SUBSCRIPTION = Symbol('app:requires-subscription');

/**
 * Marks a route as available only to a paying reference.
 *
 * This is the paywall, and it lives on the server. Hiding a menu entry is a courtesy
 * to the reader; this is the part that actually refuses, because anything the browser
 * decides can be changed by whoever is holding the browser.
 */
export const RequireSubscription = (): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRES_SUBSCRIPTION, true);
