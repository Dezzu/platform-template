import { Directive } from '@angular/core';

/**
 * Marks markup projected into a `dui-*` field as its leading icon.
 *
 * It lets a component know whether to render the addon even when the `icon` input is
 * empty: Angular offers no other way to detect the presence of
 * contenuto proiettato.
 */
@Directive({ selector: '[duiInputIcon]' })
export class DuiInputIcon {}
