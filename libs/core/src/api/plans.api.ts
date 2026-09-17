import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Plan } from '@app/contracts';
import type { Observable } from 'rxjs';
import { CORE_CONFIG } from '../config/core.config';

/** The public plan catalogue. No session needed: the marketing site renders it too. */
@Service()
export class PlansApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/plans`;

  list(): Observable<Plan[]> {
    return this.http.get<Plan[]>(this.base);
  }
}
