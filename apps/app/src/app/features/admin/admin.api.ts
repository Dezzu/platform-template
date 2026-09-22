import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { CORE_CONFIG } from '@app/core';
import type {
  AdminBan,
  OrgRole,
  AdminOrganization,
  AdminOrganizationDetail,
  AdminOrganizationListQuery,
  AdminUser,
  AdminUserListQuery,
  Paginated,
  PlatformRole,
} from '@app/contracts';
import type { Observable } from 'rxjs';

function toParams(query: Record<string, unknown>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

@Service()
export class AdminApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/admin`;

  listUsers(query: Partial<AdminUserListQuery> = {}): Observable<Paginated<AdminUser>> {
    return this.http.get<Paginated<AdminUser>>(`${this.base}/users`, { params: toParams(query) });
  }

  setRole(userId: string, role: PlatformRole): Observable<AdminUser> {
    return this.http.patch<AdminUser>(`${this.base}/users/${userId}/role`, { role });
  }

  sendPasswordReset(userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${userId}/password-reset`, {});
  }

  ban(userId: string, payload: AdminBan): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${userId}/ban`, payload);
  }

  unban(userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${userId}/unban`, {});
  }

  revokeSessions(userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${userId}/revoke-sessions`, {});
  }

  impersonate(userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${userId}/impersonate`, {});
  }

  stopImpersonating(): Observable<void> {
    return this.http.post<void>(`${this.base}/stop-impersonating`, {});
  }

  sendVerificationEmail(userId: string): Observable<void> {
    return this.http.post<void>(`${this.base}/users/${userId}/verification-email`, {});
  }

  /** The role inside one organization, changed from outside it. */
  setOrganizationRole(organizationId: string, userId: string, role: OrgRole): Observable<void> {
    return this.http.patch<void>(
      `${this.base}/organizations/${organizationId}/members/${userId}/role`,
      { role },
    );
  }

  listOrganizations(
    query: Partial<AdminOrganizationListQuery> = {},
  ): Observable<Paginated<AdminOrganization>> {
    return this.http.get<Paginated<AdminOrganization>>(`${this.base}/organizations`, {
      params: toParams(query),
    });
  }

  getOrganization(id: string): Observable<AdminOrganizationDetail> {
    return this.http.get<AdminOrganizationDetail>(`${this.base}/organizations/${id}`);
  }
}
