import { Directive, inject, input, TemplateRef } from '@angular/core';

/**
 * Names a projected `ng-template` so a component can pick it up by name:
 * `<ng-template duiTemplate="row"> … </ng-template>`.
 *
 * `TemplateRef` is injected with `inject()` rather than as a constructor parameter:
 * as a parameter it only appears in type position, and a lint autofix would turn the
 * import into `import type`, which removes it at runtime and breaks injection.
 */
@Directive({ selector: '[duiTemplate]' })
export class TemplateDirective {
  readonly template = inject(TemplateRef<unknown>);

  /** The slot this template fills. */
  readonly name = input.required<string>({ alias: 'duiTemplate' });
}
