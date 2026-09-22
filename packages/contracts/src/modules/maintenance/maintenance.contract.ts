import { z } from 'zod';
import { PLATFORM_ROLES } from '../../common/permissions';

/**
 * Maintenance mode: the whole API answers 503 while it is on, except for the accounts
 * listed in `allowRoles`.
 *
 * Stored as one row in `app_setting` rather than as an environment variable, because
 * the moment you need it is the moment you cannot deploy — and a variable would mean
 * turning the lights out by restarting every container.
 */
export const MaintenanceModeSchema = z.object({
  enabled: z.boolean(),
  /**
   * An i18n key, never a sentence: the notice is shown to every visitor in their own
   * language, and a literal typed into the admin form would be shown in whichever
   * language the administrator happened to be thinking in.
   */
  messageKey: z.string().max(200).nullable(),
  /** Shown as "back by", when known. Purely informative — nothing expires on it. */
  until: z.iso.datetime().nullable(),
  /**
   * Who still gets through. Platform roles, not organization roles: maintenance is a
   * property of the deployment, and an organization owner is a customer like any other.
   *
   * Never empty — locking everyone out includes locking out whoever would turn it back
   * off, and the only remaining way in would be an UPDATE against production.
   */
  allowRoles: z.array(z.enum(PLATFORM_ROLES)).min(1),
});
export type MaintenanceMode = z.infer<typeof MaintenanceModeSchema>;

/** The full object is sent every time: a partial toggle of a four-field form is not
 * worth the ambiguity of "absent means unchanged" on the one screen that takes the
 * product offline. */
export const MaintenanceModeUpdateSchema = MaintenanceModeSchema;
export type MaintenanceModeUpdate = z.infer<typeof MaintenanceModeUpdateSchema>;

/** Sensible starting point, and what the seed writes. */
export const DEFAULT_MAINTENANCE_MODE: MaintenanceMode = {
  enabled: false,
  messageKey: null,
  until: null,
  allowRoles: ['superadmin'],
};

/** The app_setting key this lives under. Shared so nobody retypes the string. */
export const MAINTENANCE_SETTING_KEY = 'maintenance_mode';
