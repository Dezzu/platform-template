import { describe, expect, it } from 'vitest';
import {
  CONSENT_VERSION,
  defaultConsent,
  parseConsent,
  type ConsentRecord,
} from '@app/contracts/consent';

/**
 * The one property worth protecting here: **absence is not consent, and neither is a
 * stale yes**.
 *
 * Everything else in the banner is rendering. This function is the rule — it decides
 * whether somebody is asked again — and every case below is a way of quietly treating
 * an unanswered question as answered, which is the thing the regulation is about.
 */
describe('parseConsent', () => {
  const valid: ConsentRecord = {
    version: CONSENT_VERSION,
    decidedAt: '2026-09-01T10:00:00.000Z',
    granted: { necessary: true, preferences: true, analytics: false, marketing: false },
  };

  it('reads back a record it was given', () => {
    expect(parseConsent(JSON.stringify(valid))).toEqual(valid);
  });

  it('treats a record from an older version as no answer at all', () => {
    const older = JSON.stringify({ ...valid, version: CONSENT_VERSION - 1 });
    // Consent is to a specific question. Carrying an old "yes" over to a question that
    // now covers something else is exactly what must not happen.
    expect(parseConsent(older)).toBeUndefined();
  });

  it('treats a record missing a category as no answer at all', () => {
    const { marketing: _dropped, ...partial } = valid.granted;
    expect(parseConsent(JSON.stringify({ ...valid, granted: partial }))).toBeUndefined();
  });

  it('is undefined for nothing, for rubbish, and for the wrong shape', () => {
    expect(parseConsent(null)).toBeUndefined();
    expect(parseConsent('')).toBeUndefined();
    expect(parseConsent('not json')).toBeUndefined();
    expect(parseConsent('"a string"')).toBeUndefined();
    expect(parseConsent(JSON.stringify({ version: CONSENT_VERSION }))).toBeUndefined();
  });

  it('forces the necessary category on, whatever the cookie claims', () => {
    const tampered = JSON.stringify({
      ...valid,
      granted: { ...valid.granted, necessary: false },
    });
    // A cookie is client-side state: it can be edited. Reading "necessary: false" back
    // as false would mean a browser could switch off the session cookie by hand.
    expect(parseConsent(tampered)?.granted.necessary).toBe(true);
  });
});

describe('defaultConsent', () => {
  it('starts with everything optional switched off', () => {
    expect(defaultConsent()).toEqual({
      necessary: true,
      preferences: false,
      analytics: false,
      marketing: false,
    });
  });
});
