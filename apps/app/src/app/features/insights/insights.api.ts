import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Insights } from '@app/contracts';
import type { Observable } from 'rxjs';
import { CORE_CONFIG } from '@app/core';

@Service()
export class InsightsApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/insights`;

  get(): Observable<Insights> {
    return this.http.get<Insights>(this.base);
  }
}
