import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { CORE_CONFIG } from '@app/core';
import type { AuditEntry, AuditFacets, AuditListQuery, Paginated } from '@app/contracts';
import type { Observable } from 'rxjs';

@Service()
export class AuditApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/audit`;

  list(query: Partial<AuditListQuery> = {}): Observable<Paginated<AuditEntry>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Paginated<AuditEntry>>(this.base, { params });
  }

  /** The actions actually present, so the filter never offers one that matches nothing. */
  facets(): Observable<AuditFacets> {
    return this.http.get<AuditFacets>(`${this.base}/facets`);
  }
}
