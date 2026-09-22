import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { CanPlatformDirective } from '@app/core';

/**
 * The heading and the tabs of the administration area.
 *
 * Extracted once there were four screens: four copies of the same `<nav>` is four
 * places to forget a link, and the one that gets forgotten is always the newest —
 * which is the one nobody can find yet.
 *
 * Each tab is gated on the permission its own screen requires, so a support admin
 * (who holds `platform.users.read` and nothing else) sees two tabs rather than four,
 * two of which greet them with a blank page.
 */
@Component({
  selector: 'app-admin-nav',
  imports: [RouterLink, RouterLinkActive, TranslocoPipe, CanPlatformDirective],
  templateUrl: './admin-nav.component.html',
})
export class AdminNavComponent {}
