import { inject, Injector, Pipe, type PipeTransform, type ProviderToken } from '@angular/core';

/**
 * Applies a pipe named at runtime, so a table column can declare `pipe: 'date'` in
 * data rather than in a template.
 *
 * Uses `inject()` rather than constructor injection on purpose: with a constructor
 * parameter, `Injector` appears only in type position and a lint autofix would rewrite
 * it to `import type`, removing the runtime import and breaking injection.
 */
@Pipe({ name: 'dynamicPipe' })
export class DynamicPipe implements PipeTransform {
  private readonly injector = inject(Injector);

  transform(
    value: unknown,
    pipeToken: ProviderToken<PipeTransform> | null,
    pipeArgs: unknown[] = [],
  ): unknown {
    if (!pipeToken) return value;

    try {
      return this.injector.get(pipeToken).transform(value, ...pipeArgs);
    } catch (error: unknown) {
      // A missing pipe is a configuration mistake in a column definition, not a reason
      // to blank the cell: show the raw value and say why.
      console.warn(`Pipe ${String(pipeToken)} not found`, error);
      return value;
    }
  }
}
