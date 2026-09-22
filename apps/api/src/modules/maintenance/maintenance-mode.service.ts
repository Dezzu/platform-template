import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_MAINTENANCE_MODE,
  MAINTENANCE_SETTING_KEY,
  MaintenanceModeSchema,
  type MaintenanceMode,
  type MaintenanceModeUpdate,
} from '@app/contracts';
import { appSetting, type Database } from '@app/db';
import { DRIZZLE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { PlatformActor } from '../admin/admin-users.service';

/**
 * How long the setting is reused before being read again.
 *
 * This value is on the hot path of every single request — MaintenanceGuard asks before
 * anything else happens — so a round trip per request is not an option. Ten seconds is
 * the delay between an administrator flipping the switch and the last container
 * noticing, which is the right trade for a screen whose whole purpose is to be used
 * while something is already going wrong.
 */
const TTL_MS = 10_000;

/**
 * Maintenance mode, stored in `app_setting` rather than in the environment.
 *
 * Deliberate: the moment you need to take the product offline is the moment you would
 * rather not be deploying, and an environment variable means a restart of every
 * container to set it and another to unset it.
 */
@Injectable()
export class MaintenanceModeService {
  private cached: { at: number; value: MaintenanceMode } | null = null;

  constructor(
    private readonly audit: AuditService,
    @Inject(DRIZZLE) private readonly db: Database,
  ) {}

  async get(): Promise<MaintenanceMode> {
    if (this.cached && Date.now() - this.cached.at < TTL_MS) return this.cached.value;

    const [row] = await this.db
      .select({ value: appSetting.value })
      .from(appSetting)
      .where(eq(appSetting.key, MAINTENANCE_SETTING_KEY))
      .limit(1);

    /**
     * A missing or malformed row means "not in maintenance", never an exception.
     * This runs before every request: a guard that throws because somebody hand-edited
     * a jsonb column would take the whole API down to report that the API is up.
     */
    const parsed = MaintenanceModeSchema.safeParse(row?.value);
    const value = parsed.success ? parsed.data : DEFAULT_MAINTENANCE_MODE;

    this.cached = { at: Date.now(), value };
    return value;
  }

  async set(actor: PlatformActor, input: MaintenanceModeUpdate): Promise<MaintenanceMode> {
    const before = await this.get();

    await this.db.transaction(async (tx) => {
      await tx
        .insert(appSetting)
        .values({ key: MAINTENANCE_SETTING_KEY, value: input })
        .onConflictDoUpdate({
          target: appSetting.key,
          set: { value: input, updatedAt: new Date() },
        });

      await this.audit.record(
        {
          // Platform-wide: it belongs to no tenant, which is also why it does not
          // appear in any organization's activity log.
          organizationId: null,
          actorUserId: actor.userId,
          action: input.enabled ? 'maintenance.enabled' : 'maintenance.disabled',
          resourceType: 'app_setting',
          resourceId: MAINTENANCE_SETTING_KEY,
          before,
          after: input,
        },
        tx,
      );
    });

    this.cached = { at: Date.now(), value: input };
    return input;
  }

  /**
   * Whether this platform role still gets through.
   *
   * Nothing is allowed through by being anonymous: an unauthenticated caller has no
   * role, and "no role" is not on any allow list.
   */
  allows(mode: MaintenanceMode, role: string | null | undefined): boolean {
    if (!mode.enabled) return true;
    return role !== null && role !== undefined && mode.allowRoles.includes(role as never);
  }
}
