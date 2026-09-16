import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * The root holds nothing but the outlet: the frame lives in ShellPage, behind the
 * auth guard, so the sign-in screen is not wrapped in a sidebar it has no use for.
 */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  host: { class: 'block min-h-screen' },
})
export class App {}
