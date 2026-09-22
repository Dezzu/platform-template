import { Directive, effect, inject, input, TemplateRef, ViewContainerRef } from '@angular/core';
import { FeatureFlagsService } from './feature-flags.service';

/**
 * Shows its content only while a feature flag is on for this user.
 *
 *   <section *appIfFlag="'notifications.inApp'">…</section>
 *
 * A courtesy to the reader, never a control: a flag that only exists in the browser is
 * a suggestion, so anything behind it that the API can refuse carries @RequireFeature()
 * on the backend too.
 */
@Directive({ selector: '[appIfFlag]' })
export class IfFlagDirective {
  private readonly flags = inject(FeatureFlagsService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);

  readonly appIfFlag = input.required<string>();

  private rendered = false;

  constructor() {
    effect(() => {
      const on = this.flags.enabled(this.appIfFlag());

      if (on && !this.rendered) {
        this.container.createEmbeddedView(this.template);
        this.rendered = true;
      } else if (!on && this.rendered) {
        this.container.clear();
        this.rendered = false;
      }
    });
  }
}
