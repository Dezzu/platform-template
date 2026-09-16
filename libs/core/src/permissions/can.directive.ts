import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import type { Permission } from '@app/contracts';
import { PermissionsService } from './permissions.service';

/**
 * Shows its content only when the user holds the permissions.
 *
 *   <button *appCan="['projects.manage']">New project</button>
 *   <button *appCan="['billing.read', 'billing.manage']; mode: 'all'">…</button>
 *
 * A convenience for the reader, not a control: the API re-checks every request. Hiding
 * a button the server would refuse anyway keeps the interface honest about what this
 * user can do.
 */
@Directive({ selector: '[appCan]' })
export class CanDirective {
  private readonly permissions = inject(PermissionsService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  readonly appCan = input.required<readonly Permission[]>();
  readonly appCanMode = input<'any' | 'all'>('any');

  private rendered = false;

  constructor() {
    effect(() => {
      const required = this.appCan();
      const allowed =
        required.length === 0
          ? true
          : this.appCanMode() === 'all'
            ? this.permissions.allOf(...required)
            : this.permissions.anyOf(...required);

      if (allowed && !this.rendered) {
        this.container.createEmbeddedView(this.template);
        this.rendered = true;
      } else if (!allowed && this.rendered) {
        this.container.clear();
        this.rendered = false;
      }
    });
  }
}
