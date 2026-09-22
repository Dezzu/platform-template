/**
 * The alerts a page itself rendered, excluding the field components'.
 *
 * Spartan's field wrapper renders a `role="alert"` slot for every input and keeps it
 * hidden until that field is invalid. A bare `querySelector('[role="alert"]')` on a
 * screen with a form therefore always finds something — so a test written against it
 * passes whether or not the message it was looking for was ever shown. This was caught
 * the only way it could be: by a test that failed for the opposite reason.
 */
export function pageAlerts(fixture: { nativeElement: unknown }): string {
  const root = fixture.nativeElement as HTMLElement;
  return [...root.querySelectorAll('[role="alert"]:not([data-slot="field-error"])')]
    .map((node) => node.textContent ?? '')
    .join(' ');
}
