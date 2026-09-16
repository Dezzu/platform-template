import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'web-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  host: { class: 'block min-h-screen' },
})
export class App {}
