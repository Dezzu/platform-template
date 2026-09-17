import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import type { PlatformPermission } from '@app/contracts';
import { PermissionsService } from './permissions.service';

/**
 * Shows its content only when the user holds one of the PLATFORM permissions.
 *
 *   <button *appCanPlatform="['platform.users.manage']">Ban</button>
 *
 * Separate from `*appCan` rather than an extra mode on it, for the same reason the
 * backend has two decorators: platform rights come from `user.role` and cross tenant
 * boundaries, and one directive taking either kind would be one typo away from showing
 * an administration control to an organization admin.
 *
 * A convenience for the reader, not a control — the API re-checks every call.
 */
@Directive({ selector: '[appCanPlatform]' })
export class CanPlatformDirective {
  private readonly permissions = inject(PermissionsService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  readonly appCanPlatform = input.required<readonly PlatformPermission[]>();

  private rendered = false;

  constructor() {
    effect(() => {
      const required = this.appCanPlatform();
      const allowed = required.length === 0 || this.permissions.anyOfPlatform(...required);

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
