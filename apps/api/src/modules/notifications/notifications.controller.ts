import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  type MessageEvent,
  Param,
  Post,
  Put,
  Query,
  Sse,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Session, type UserSession } from '@thallesp/nestjs-better-auth';
import {
  IN_APP_NOTIFICATIONS_FLAG,
  PERMISSIONS,
  NotificationListQuerySchema,
  NotificationPreferenceSchema,
  NotificationPreferenceUpdateSchema,
  NotificationSchema,
  UnreadCountSchema,
  zPaginated,
  type Notification,
  type NotificationListQuery,
  type NotificationPreference,
  type NotificationPreferenceUpdate,
  type Paginated,
  type UnreadCount,
} from '@app/contracts';
import { ApiEnvelope, ApiStandardErrors, RawResponse } from '../../common';
import { CurrentOrg, CurrentOrgOptional, type OrgContext } from '../../auth/org-context';
import { OrgOptional, RequirePermissions } from '../../auth/permissions.decorator';
import { RequireFeature } from '../flags/feature.decorator';
import { NotificationsService } from './notifications.service';

/**
 * Your own notifications, and your own preferences.
 *
 * No permission guards the reading routes beyond membership: a notification is
 * addressed to one person, and the service filters by the caller's own id on top of
 * the tenant scope. There is no "read everyone's notifications" operation to protect,
 * because there is no such thing.
 *
 * Preferences are deliberately NOT tenant-scoped — "do not email me about this" is a
 * statement about a person, not about an organization, so those two routes work even
 * for somebody who has not picked one yet.
 *
 * They are also the only routes here **not** behind `notifications.inApp`, and for the
 * same reason: that flag switches off the in-app centre, not notifications. Email keeps
 * flowing, so the switches that govern email have to stay reachable — including the one
 * that says a channel is mandatory.
 */
@ApiTags('notifications')
@ApiStandardErrors()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.ORG_READ)
  @RequireFeature(IN_APP_NOTIFICATIONS_FLAG)
  @ApiOperation({ summary: 'The notifications addressed to you in this organization' })
  @ApiEnvelope(zPaginated(NotificationSchema))
  list(
    @CurrentOrg() org: OrgContext,
    @Query({ schema: NotificationListQuerySchema }) query: NotificationListQuery,
  ): Promise<Paginated<Notification>> {
    return this.notifications.list(org, query);
  }

  /** What the bell shows. Separate from the list because it is polled on its own. */
  @Get('unread-count')
  @RequirePermissions(PERMISSIONS.ORG_READ)
  @RequireFeature(IN_APP_NOTIFICATIONS_FLAG)
  @ApiOperation({ summary: 'How many are still unread' })
  @ApiEnvelope(UnreadCountSchema)
  async unreadCount(@CurrentOrg() org: OrgContext): Promise<UnreadCount> {
    return { unread: await this.notifications.unreadCount(org) };
  }

  /**
   * Before `:id/read`, or 'read-all' would be parsed as an identifier — the router
   * matches in declaration order.
   */
  @Post('read-all')
  @RequirePermissions(PERMISSIONS.ORG_READ)
  @RequireFeature(IN_APP_NOTIFICATIONS_FLAG)
  // 200, not Nest's default 201 for POST: nothing is created, a flag moves.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark everything read' })
  @ApiEnvelope(UnreadCountSchema)
  async markAllRead(@CurrentOrg() org: OrgContext): Promise<UnreadCount> {
    await this.notifications.markAllRead(org);
    // Zero by construction, and returned rather than left to the client to assume:
    // the bell binds to whatever this endpoint says.
    return { unread: 0 };
  }

  @Post(':id/read')
  @RequirePermissions(PERMISSIONS.ORG_READ)
  @RequireFeature(IN_APP_NOTIFICATIONS_FLAG)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one read' })
  @ApiEnvelope(NotificationSchema)
  markRead(@CurrentOrg() org: OrgContext, @Param('id') id: string): Promise<Notification> {
    return this.notifications.markRead(org, id);
  }

  /**
   * The live connection: one long-lived response, one event per notification raised.
   *
   * Before this the badge was set once, when the shell was built, and nothing moved it
   * again — so a notification that arrived while you were looking at the page appeared
   * only after a reload. That is what this replaces, and it replaces it with a push
   * rather than with a poll: a timer would be a request per person per interval
   * forever for a number that is almost always zero, which is the trade CLAUDE.md said
   * to refuse until server-sent events were worth it.
   *
   * `@OrgOptional()`, not a permission: `EventSource` cannot set headers, so this is
   * authenticated by the session cookie like everything else, and the tenant is
   * whatever the caller is working in — used to filter, not to authorise. What
   * authorises is inside `streamFor`, which only ever forwards events addressed to
   * this user.
   *
   * `@RawResponse()` keeps the envelope off it — see the interceptor.
   */
  @Sse('stream')
  @OrgOptional()
  @RequireFeature(IN_APP_NOTIFICATIONS_FLAG)
  @RawResponse()
  @ApiOperation({ summary: 'Server-sent events: one per notification raised for you' })
  stream(
    @Session() session: UserSession,
    @CurrentOrgOptional() org: OrgContext | null,
  ): Observable<MessageEvent> {
    return this.notifications.streamFor(session.user.id, org?.organizationId ?? null);
  }

  @Get('preferences')
  @OrgOptional()
  @ApiOperation({ summary: 'Every switch, with the effective answer' })
  @ApiEnvelope(NotificationPreferenceSchema.array())
  preferences(@Session() session: UserSession): Promise<NotificationPreference[]> {
    return this.notifications.preferences(session.user.id);
  }

  @Put('preferences')
  @OrgOptional()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change one switch' })
  @ApiEnvelope(NotificationPreferenceSchema.array())
  setPreference(
    @Session() session: UserSession,
    @Body({ schema: NotificationPreferenceUpdateSchema }) body: NotificationPreferenceUpdate,
  ): Promise<NotificationPreference[]> {
    return this.notifications.setPreference(session.user.id, body);
  }
}
