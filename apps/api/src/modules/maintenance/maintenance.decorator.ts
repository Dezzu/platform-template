import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_MAINTENANCE_METADATA = Symbol('app:allow-during-maintenance');

/**
 * Keeps a route answering while maintenance mode is on.
 *
 * Used by exactly two kinds of endpoint, and the list should stay that short:
 *  - the health probes, because an orchestrator that reads 503 as "this container is
 *    broken" will restart containers for as long as the maintenance lasts;
 *  - the maintenance endpoints themselves, because the way out has to be reachable
 *    from inside — the same principle as the button that ends an impersonation.
 */
export const AllowDuringMaintenance = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_DURING_MAINTENANCE_METADATA, true);
