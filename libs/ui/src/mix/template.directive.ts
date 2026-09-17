import { Directive, inject, input, TemplateRef } from '@angular/core';

/**
 * What a named template receives: the cell value, and the whole row alongside it.
 *
 * Both are `unknown` because the directive cannot know the row type of the table that
 * projected it — the slot is matched by name at runtime. Consumers narrow once, at the
 * top of their template, rather than sprinkling casts through it.
 */
export interface TemplateContext {
  /** The cell value for this column. */
  $implicit: unknown;
  /** The whole row. */
  item: unknown;
}

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
  readonly template = inject(TemplateRef<TemplateContext>);

  /** The slot this template fills. */
  readonly name = input.required<string>({ alias: 'duiTemplate' });

  /**
   * Without this, `let-item="item"` is an implicit `any` and strict templates refuse
   * to compile the consumer. It types the context as far as it honestly can.
   */
  static ngTemplateContextGuard(
    _directive: TemplateDirective,
    _context: unknown,
  ): _context is TemplateContext {
    return true;
  }
}
