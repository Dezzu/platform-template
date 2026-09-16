# libs/ui

There is deliberately **no root barrel**. Import from the entry point you need:

```ts
import { AppShellComponent } from '@app/ui/layout';
import { TextInputComponent } from '@app/ui/input';
import { TableComponent } from '@app/ui/table';
```

A single `@app/ui` barrel re-exporting everything looks tidier and costs a lot: the
shell, which every authenticated route loads, would drag the table, the date picker
and every input into the initial bundle along with the `@spartan-ng/brain` code behind
them. Measured on this repo, that was 204 kB of brain in the initial chunk for a screen
that renders a sidebar and a header.

Subpath entry points make the boundary structural rather than a matter of discipline.
