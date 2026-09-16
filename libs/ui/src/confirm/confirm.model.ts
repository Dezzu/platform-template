/**
 * What to ask, and what to call it.
 *
 * Only `title` is required, and it is deliberately a question: "Delete the role
 * Site manager?" can be read and answered; "Confirm operation" cannot.
 */
export interface ConfirmOptions {
  /** The question. Short, naming the thing being acted on. */
  title: string;

  /**
   * The consequence, when it is not obvious.
   *
   * This is the line that prevents the follow-up phone call: what happens to what
   * was there, who notices, whether it can be undone.
   */
  message?: string;

  /**
   * Label of the confirming button.
   *
   * The verb of the action — "Delete", "Suspend" — never "OK": someone who reads
   * only the buttons has to understand what is about to happen.
   */
  confirmLabel?: string;

  /** Label of the cancelling button. */
  cancelLabel?: string;

  /**
   * The action destroys something, or is hard to undo.
   *
   * Two things change: the confirm button turns red, and focus lands on "Cancel"
   * rather than on the confirmation — so an Enter pressed out of habit deletes
   * nothing.
   */
  destructive?: boolean;
}
