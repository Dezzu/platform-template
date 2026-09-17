import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { CORE_CONFIG } from '@app/core';
import type {
  FileDownload,
  FileListQuery,
  FileMetadata,
  FileUploadTicket,
  Paginated,
} from '@app/contracts';
import { firstValueFrom, type Observable } from 'rxjs';

/**
 * Transport for the two-step upload.
 *
 * `upload` is the odd one out: it PUTs to the object store, not to our API. The
 * interceptor leaves it alone — it only touches URLs under `apiUrl` — which is what we
 * want, because attaching our session cookie to a third-party host would be both
 * useless and a leak.
 */
@Service()
export class FilesApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/files`;

  list(query: Partial<FileListQuery> = {}): Observable<Paginated<FileMetadata>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Paginated<FileMetadata>>(this.base, { params });
  }

  requestTicket(file: File): Observable<FileUploadTicket> {
    return this.http.post<FileUploadTicket>(`${this.base}/upload-url`, {
      fileName: file.name,
      // Browsers leave this empty for extensions they do not recognise, and an empty
      // content type fails the contract's minimum length.
      contentType: file.type || 'application/octet-stream',
      size: file.size,
    });
  }

  /** Sends the bytes straight to storage with the headers the signature covers. */
  async upload(ticket: FileUploadTicket, file: File): Promise<void> {
    await firstValueFrom(
      this.http.put(ticket.uploadUrl, file, {
        headers: ticket.requiredHeaders,
        responseType: 'text',
      }),
    );
  }

  commit(id: string): Observable<FileMetadata> {
    return this.http.post<FileMetadata>(`${this.base}/${id}/commit`, {});
  }

  downloadUrl(id: string): Observable<FileDownload> {
    return this.http.get<FileDownload>(`${this.base}/${id}/download-url`);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
