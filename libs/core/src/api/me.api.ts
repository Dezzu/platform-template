import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Me, UpdateProfile, UserProfile } from '@app/contracts';
import type { Observable } from 'rxjs';
import { CORE_CONFIG } from '../config/core.config';

/**
 * HTTP access to /me.
 *
 * `*Api` services are thin and return Observables: transport is RxJS, state is
 * signals. Nothing here caches or stores — that belongs to the services that own the
 * state, such as AuthService and PermissionsService.
 *
 * The envelope is already unwrapped by apiInterceptor, so the observable carries the
 * payload directly.
 */
@Service()
export class MeApi {
  private readonly http = inject(HttpClient);
  private readonly base = `${inject(CORE_CONFIG).apiUrl}/me`;

  get(): Observable<Me> {
    return this.http.get<Me>(this.base);
  }

  update(changes: UpdateProfile): Observable<UserProfile> {
    return this.http.patch<UserProfile>(this.base, changes);
  }
}
