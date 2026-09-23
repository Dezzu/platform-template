import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { DeletionRequest, GdprExportDownload, GdprExportRequest } from '@app/contracts';
import type { Observable } from 'rxjs';
import { CORE_CONFIG } from '../config/core.config';

/**
 * HTTP access to /gdpr. Thin, Observable-returning, stores nothing.
 *
 * The scope is in the method name because it is in the route: exporting yourself and
 * exporting your employer are different permissions, and a single call taking a scope
 * argument would hide that from the caller.
 */
@Service()
export class GdprApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/gdpr`;

  listExports(): Observable<GdprExportRequest[]> {
    return this.http.get<GdprExportRequest[]>(`${this.base}/exports`);
  }

  requestPersonalExport(): Observable<GdprExportRequest> {
    return this.http.post<GdprExportRequest>(`${this.base}/exports/me`, {});
  }

  requestOrganizationExport(): Observable<GdprExportRequest> {
    return this.http.post<GdprExportRequest>(`${this.base}/exports/organization`, {});
  }

  /**
   * Asks for a fresh link every time rather than keeping one.
   *
   * A presigned URL is the archive. Holding it in a component's state means it
   * survives in memory — and in any error report the page sends — long after the
   * click that needed it.
   */
  download(id: string): Observable<GdprExportDownload> {
    return this.http.get<GdprExportDownload>(`${this.base}/exports/${id}/download`);
  }

  listDeletionRequests(): Observable<DeletionRequest[]> {
    return this.http.get<DeletionRequest[]>(`${this.base}/deletion-requests`);
  }

  scheduleAccountDeletion(reason?: string): Observable<DeletionRequest> {
    return this.http.post<DeletionRequest>(
      `${this.base}/deletion-requests/account`,
      reason ? { reason } : {},
    );
  }

  scheduleOrganizationDeletion(reason?: string): Observable<DeletionRequest> {
    return this.http.post<DeletionRequest>(
      `${this.base}/deletion-requests/organization`,
      reason ? { reason } : {},
    );
  }

  cancelDeletion(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/deletion-requests/${id}`);
  }
}
