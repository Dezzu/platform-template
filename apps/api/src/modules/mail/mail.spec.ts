import { describe, expect, it } from 'vitest';
import { escapeHtml, renderHtml, renderText } from './templates/layout';
import { EMAIL_TEMPLATES, isEmailTemplateId } from './templates/registry';
import { EMAIL_LOCALES, type EmailLocale, type EmailTemplate } from './templates/template.types';
import { redactParams } from './mail.service';

const context = (locale: EmailLocale) => ({ appName: 'Acme Suite', locale });

/** Parameters good enough to render each template, keyed by id. */
const SAMPLES: Record<string, Record<string, unknown>> = {
  'email-verification': { name: 'Erika', url: 'https://app.example.com/verify?token=abc' },
  'password-reset': { name: 'Erika', url: 'https://app.example.com/reset?token=abc' },
  'organization-invitation': {
    organizationName: 'Acme Srl',
    inviterName: 'Fabio',
    role: 'member',
    url: 'https://app.example.com/accept-invitation?id=inv_1',
  },
  'member-joined': {
    organizationName: 'Acme Srl',
    memberName: 'Erika',
    url: 'https://app.example.com/members',
  },
  'payment-failed': {
    organizationName: 'Acme Srl',
    url: 'https://app.example.com/billing',
  },
  'gdpr-export-ready': {
    name: 'Erika',
    scope: 'user',
    expiresAt: '2026-10-01T10:00:00.000Z',
    privacyUrl: 'https://app.example.com/privacy',
  },
  'account-deletion-scheduled': {
    name: 'Erika',
    subjectType: 'user',
    scheduledFor: '2026-10-23T10:00:00.000Z',
    privacyUrl: 'https://app.example.com/privacy',
  },
};

describe('email template registry', () => {
  it('keys the registry by each template id', () => {
    for (const [key, template] of Object.entries(EMAIL_TEMPLATES)) {
      expect(template.id).toBe(key);
    }
  });

  it('renders every template in every locale', () => {
    // Iterating the registry collapses its per-template parameter types into an
    // intersection nothing satisfies; the loop only runs the schema and the renderer,
    // neither of which needs to know which template it got.
    const all = Object.entries(EMAIL_TEMPLATES) as [string, EmailTemplate<unknown>][];

    for (const [id, template] of all) {
      const params = template.schema.parse(SAMPLES[id]);

      for (const locale of EMAIL_LOCALES) {
        const content = template.render[locale](params, context(locale));
        expect(content.subject.length).toBeGreaterThan(0);
        expect(content.heading.length).toBeGreaterThan(0);
        expect(content.paragraphs.length).toBeGreaterThan(0);
        // No template may leave a placeholder unresolved.
        expect(`${content.subject} ${content.heading}`).not.toMatch(/undefined|\[object/);
      }
    }
  });

  it('rejects parameters that do not match the schema', () => {
    const template = EMAIL_TEMPLATES['email-verification'];
    expect(() => template.schema.parse({ url: 'not-a-url' })).toThrow();
  });

  it('recognises only ids it holds', () => {
    expect(isEmailTemplateId('password-reset')).toBe(true);
    expect(isEmailTemplateId('constructor')).toBe(false);
    expect(isEmailTemplateId('nope')).toBe(false);
  });
});

describe('layout', () => {
  it('escapes an organization name a stranger chose', () => {
    const template = EMAIL_TEMPLATES['organization-invitation'];
    const params = template.schema.parse({
      ...SAMPLES['organization-invitation'],
      organizationName: '<script>alert(1)</script>',
    });
    const html = renderHtml(template.render.en(params, context('en')), context('en'));

    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('drops a link that is not http(s)', () => {
    const content = {
      subject: 's',
      heading: 'h',
      paragraphs: ['p'],
      action: { label: 'Click', url: 'javascript:alert(1)' },
    };
    const html = renderHtml(content, context('en'));

    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('Click');
  });

  it('produces a text alternative carrying the same link', () => {
    const content = {
      subject: 's',
      heading: 'Reset',
      paragraphs: ['Body'],
      action: { label: 'Open', url: 'https://example.com/x' },
    };
    const text = renderText(content, context('en'));

    expect(text).toContain('Reset');
    expect(text).toContain('https://example.com/x');
    expect(text).not.toContain('<');
  });

  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('redactParams', () => {
  it('masks anything whose name suggests it unlocks something', () => {
    const redacted = redactParams({
      name: 'Erika',
      url: 'https://app.example.com/reset?token=secret',
      inviteCode: 'ABC123',
      role: 'member',
    });

    expect(redacted).toEqual({
      name: 'Erika',
      url: '[redacted]',
      inviteCode: '[redacted]',
      role: 'member',
    });
  });

  it('survives a non-object', () => {
    expect(redactParams(null)).toEqual({});
    expect(redactParams('nope')).toEqual({});
  });
});
