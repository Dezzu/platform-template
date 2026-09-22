import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type {
  Notification,
  NotificationListQuery,
  NotificationPreference,
  NotificationPreferenceUpdate,
  Paginated,
  UnreadCount,
} from '@app/contracts';
import type { Observable } from 'rxjs';
import { CORE_CONFIG } from '../config/core.config';

/**
 * HTTP access to /notifications. Thin, Observable-returning, stores nothing — the
 * unread count lives in NotificationCenterService.
 */
@Service()
export class NotificationsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/notifications`;

  list(query: Partial<NotificationListQuery> = {}): Observable<Paginated<Notification>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Paginated<Notification>>(this.base, { params });
  }

  unreadCount(): Observable<UnreadCount> {
    return this.http.get<UnreadCount>(`${this.base}/unread-count`);
  }

  markRead(id: string): Observable<Notification> {
    return this.http.post<Notification>(`${this.base}/${id}/read`, {});
  }

  markAllRead(): Observable<UnreadCount> {
    return this.http.post<UnreadCount>(`${this.base}/read-all`, {});
  }

  preferences(): Observable<NotificationPreference[]> {
    return this.http.get<NotificationPreference[]>(`${this.base}/preferences`);
  }

  setPreference(payload: NotificationPreferenceUpdate): Observable<NotificationPreference[]> {
    return this.http.put<NotificationPreference[]>(`${this.base}/preferences`, payload);
  }
}
