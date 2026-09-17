import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { CORE_CONFIG } from '@app/core';
import type {
  Invitation,
  InvitationCreate,
  InvitationPreview,
  Member,
  MemberListQuery,
  OrgRole,
  Paginated,
} from '@app/contracts';
import type { Observable } from 'rxjs';

@Service()
export class MembersApi {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(CORE_CONFIG).apiUrl;
  private readonly base = `${this.apiUrl}/members`;

  list(query: Partial<MemberListQuery> = {}): Observable<Paginated<Member>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Paginated<Member>>(this.base, { params });
  }

  listInvitations(): Observable<Invitation[]> {
    return this.http.get<Invitation[]>(`${this.base}/invitations`);
  }

  invite(payload: InvitationCreate): Observable<Invitation> {
    return this.http.post<Invitation>(`${this.base}/invitations`, payload);
  }

  cancelInvitation(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/invitations/${id}`);
  }

  updateRole(memberId: string, role: OrgRole): Observable<Member> {
    return this.http.patch<Member>(`${this.base}/${memberId}`, { role });
  }

  remove(memberId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${memberId}`);
  }

  /**
   * The recipient's side lives under /invitations, not /members: the caller is not a
   * member yet, so there is no tenant for the request to be scoped to.
   */
  preview(id: string): Observable<InvitationPreview> {
    return this.http.get<InvitationPreview>(`${this.apiUrl}/invitations/${id}`);
  }

  accept(id: string): Observable<{ organizationId: string }> {
    return this.http.post<{ organizationId: string }>(
      `${this.apiUrl}/invitations/${id}/accept`,
      {},
    );
  }
}
