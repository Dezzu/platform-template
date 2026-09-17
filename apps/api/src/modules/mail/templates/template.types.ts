import type { z } from 'zod';

export const EMAIL_LOCALES = ['it', 'en'] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

export function isEmailLocale(value: string): value is EmailLocale {
  return (EMAIL_LOCALES as readonly string[]).includes(value);
}

/** Context every template gets for free, so no template hardcodes the product name. */
export interface TemplateContext {
  appName: string;
  locale: EmailLocale;
}

/**
 * The rendered content of an email, as structure rather than markup.
 *
 * Templates describe *what* the email says; the layout decides how it looks. That
 * split is what lets one change to the layout restyle every email, and it is also
 * what makes the plain-text alternative free — it is generated from the same
 * structure, so it can never fall out of step with the HTML the way a hand-written
 * second copy does. Emails without a text part are scored as spam.
 */
export interface TemplateContent {
  subject: string;
  /** The <h1>. Keep it short: many clients show it as the preview line. */
  heading: string;
  /** Body paragraphs, plain sentences. No markup — the layout escapes them. */
  paragraphs: string[];
  /** The single call to action. One per email: two buttons halve the clicks on both. */
  action?: { label: string; url: string };
  /** Small print under the action, e.g. how long a link stays valid. */
  note?: string;
}

export interface EmailTemplate<P> {
  id: string;
  /**
   * Validates the parameters. The same schema runs twice: in the producer, so a bad
   * call fails at the call site, and in the worker, so a job that was enqueued by an
   * older version of the code cannot render a broken email.
   */
  schema: z.ZodType<P>;
  render: Record<EmailLocale, (params: P, context: TemplateContext) => TemplateContent>;
}

/** Helper that keeps `render` inferring P instead of widening it to unknown. */
export function defineTemplate<P>(template: EmailTemplate<P>): EmailTemplate<P> {
  return template;
}
