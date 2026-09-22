import { HttpClient } from '@angular/common/http';
import { inject, Service } from '@angular/core';
import type { Observable } from 'rxjs';
import { CORE_CONFIG } from '../config/core.config';

/**
 * The few session operations that are ours rather than Better Auth's.
 *
 * `*Api` services are thin and return Observables: transport is RxJS, state is
 * signals. The envelope is already unwrapped by apiInterceptor.
 */
@Service()
export class SessionApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(CORE_CONFIG).apiUrl;

  /**
   * Ends an impersonation and hands back the administrator's own session.
   *
   * It lives here, not in the administration area, because of who calls it: somebody
   * who is *being* impersonated at the moment they call it, and who therefore holds
   * none of the `platform.*` rights. The backend route is the one endpoint under
   * /admin that deliberately requires no platform permission, for exactly that reason
   * — so treating it as administration would be copying the URL rather than the
   * meaning.
   */
  stopImpersonating(): Observable<void> {
    return this.http.post<void>(`${this.base}/admin/stop-impersonating`, {});
  }
}
