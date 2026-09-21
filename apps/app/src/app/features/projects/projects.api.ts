import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import { CORE_CONFIG } from '@app/core';
import type {
  Paginated,
  Project,
  ProjectCreate,
  ProjectListQuery,
  ProjectUpdate,
} from '@app/contracts';
import type { Observable } from 'rxjs';

/**
 * Transport only. Types come from the same Zod contracts the API validates against, so
 * a change to the schema breaks this file at compile time rather than at runtime.
 */
@Service()
export class ProjectsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/projects`;

  list(query: Partial<ProjectListQuery> = {}): Observable<Paginated<Project>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Paginated<Project>>(this.base, { params });
  }

  getById(id: string): Observable<Project> {
    return this.http.get<Project>(`${this.base}/${id}`);
  }

  create(project: ProjectCreate): Observable<Project> {
    return this.http.post<Project>(this.base, project);
  }

  update(id: string, project: ProjectUpdate): Observable<Project> {
    return this.http.patch<Project>(`${this.base}/${id}`, project);
  }

  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}
