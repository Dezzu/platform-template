import type { TemplateContent, TemplateContext } from './template.types';

/**
 * Escapes text for HTML. Every dynamic value in an email goes through this.
 *
 * An email body carries user-controlled strings — an organization name, a display
 * name someone chose — and an email client renders HTML. The same escaping rule as
 * the web applies, minus the framework that normally does it for you.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s) links are ever rendered as a link.
 *
 * `javascript:` and `data:` URLs in an anchor are the classic way a template that
 * interpolates a caller-supplied URL becomes a phishing primitive. A URL that does
 * not pass is dropped rather than rendered inert, so the failure is visible.
 */
function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const FOOTER: Record<string, string> = {
  it: 'Hai ricevuto questa email perché è collegata a un account su',
  en: 'You are receiving this email because it is linked to an account on',
};

const FALLBACK_LINK: Record<string, string> = {
  it: 'Se il pulsante non funziona, copia questo indirizzo nel browser:',
  en: 'If the button does not work, copy this address into your browser:',
};

/**
 * Wraps rendered content in the shared shell.
 *
 * Tables and inline styles, not flexbox and a stylesheet: Outlook still renders with
 * Word's HTML engine, which supports neither. This is the one place in the repository
 * where markup from 2005 is the correct answer, which is exactly why it lives in one
 * place instead of in every template.
 */
export function renderHtml(content: TemplateContent, context: TemplateContext): string {
  const action = content.action ? { ...content.action, url: safeUrl(content.action.url) } : null;

  const paragraphs = content.paragraphs
    .map(
      (text) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#334155;">${escapeHtml(text)}</p>`,
    )
    .join('');

  const button =
    action?.url === null || !action
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
           <tr><td style="border-radius:8px;background:#0f172a;">
             <a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(action.label)}</a>
           </td></tr>
         </table>
         <p style="margin:0 0 8px;font-size:12px;color:#64748b;">${escapeHtml(FALLBACK_LINK[context.locale] ?? FALLBACK_LINK.en ?? '')}</p>
         <p style="margin:0 0 16px;font-size:12px;word-break:break-all;"><a href="${escapeHtml(action.url)}" style="color:#2563eb;">${escapeHtml(action.url)}</a></p>`;

  const note = content.note
    ? `<p style="margin:16px 0 0;font-size:13px;color:#64748b;">${escapeHtml(content.note)}</p>`
    : '';

  return `<!doctype html>
<html lang="${escapeHtml(context.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(content.subject)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;">
      <tr><td style="padding:32px;">
        <p style="margin:0 0 24px;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(context.appName)}</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a;">${escapeHtml(content.heading)}</h1>
        ${paragraphs}
        ${button}
        ${note}
      </td></tr>
      <tr><td style="padding:0 32px 32px;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">${escapeHtml(FOOTER[context.locale] ?? FOOTER.en ?? '')} ${escapeHtml(context.appName)}.</p>
      </td></tr>
    </table>
  </body>
</html>`;
}

/** The plain-text alternative, generated from the same structure as the HTML. */
export function renderText(content: TemplateContent, context: TemplateContext): string {
  const lines = [content.heading, '', ...content.paragraphs];

  if (content.action) {
    const url = safeUrl(content.action.url);
    if (url) lines.push('', `${content.action.label}: ${url}`);
  }
  if (content.note) lines.push('', content.note);

  lines.push('', `— ${context.appName}`);
  return lines.join('\n');
}
