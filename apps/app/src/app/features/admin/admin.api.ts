import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { CORE_CONFIG } from '@app/core';
import type {
  AdminBan,
  FeatureFlag,
  FeatureFlagCreate,
  FeatureFlagListQuery,
  FeatureFlagOverride,
  FeatureFlagOverrideCreate,
  FeatureFlagUpdate,
  MaintenanceMode,
  MaintenanceModeUpdate,
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
  private readonly apiUrl = inject(CORE_CONFIG).apiUrl;
  private readonly base = `${this.apiUrl}/admin`;
  /**
   * Flags and maintenance are not under /admin: they are the platform's own state and
   * `GET /flags` is answered to every signed-in caller. Only the editing half, which
   * is what this client speaks to, needs `platform.*`.
   */
  private readonly flagsBase = `${this.apiUrl}/flags/definitions`;

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

  listFlags(query: Partial<FeatureFlagListQuery> = {}): Observable<Paginated<FeatureFlag>> {
    return this.http.get<Paginated<FeatureFlag>>(this.flagsBase, { params: toParams(query) });
  }

  getFlag(key: string): Observable<FeatureFlag> {
    return this.http.get<FeatureFlag>(`${this.flagsBase}/${encodeURIComponent(key)}`);
  }

  createFlag(payload: FeatureFlagCreate): Observable<FeatureFlag> {
    return this.http.post<FeatureFlag>(this.flagsBase, payload);
  }

  updateFlag(key: string, payload: FeatureFlagUpdate): Observable<FeatureFlag> {
    return this.http.patch<FeatureFlag>(`${this.flagsBase}/${encodeURIComponent(key)}`, payload);
  }

  deleteFlag(key: string): Observable<void> {
    return this.http.delete<void>(`${this.flagsBase}/${encodeURIComponent(key)}`);
  }

  listFlagOverrides(key: string): Observable<FeatureFlagOverride[]> {
    return this.http.get<FeatureFlagOverride[]>(
      `${this.flagsBase}/${encodeURIComponent(key)}/overrides`,
    );
  }

  /** PUT, like the API: one subject has one answer, and sending it twice is not two. */
  setFlagOverride(
    key: string,
    payload: FeatureFlagOverrideCreate,
  ): Observable<FeatureFlagOverride> {
    return this.http.put<FeatureFlagOverride>(
      `${this.flagsBase}/${encodeURIComponent(key)}/overrides`,
      payload,
    );
  }

  deleteFlagOverride(key: string, id: string): Observable<void> {
    return this.http.delete<void>(`${this.flagsBase}/${encodeURIComponent(key)}/overrides/${id}`);
  }

  getMaintenance(): Observable<MaintenanceMode> {
    return this.http.get<MaintenanceMode>(`${this.apiUrl}/maintenance`);
  }

  setMaintenance(payload: MaintenanceModeUpdate): Observable<MaintenanceMode> {
    return this.http.put<MaintenanceMode>(`${this.apiUrl}/maintenance`, payload);
  }
}
