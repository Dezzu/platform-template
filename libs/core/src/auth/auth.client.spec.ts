import { describe, expect, it } from 'vitest';
import { resolveAuthBaseUrl } from './auth.client';

/**
 * Regression guard.
 *
 * The Better Auth browser client constructs a `URL` from its `baseURL` and throws
 * "Invalid base URL" on a relative path. The application deliberately configures
 * relative paths — '/api' and '/api/auth' — so one bundle runs on localhost, on a
 * preview host and in production unchanged.
 *
 * This failed only in the browser, which is precisely the gap curl-level checks leave.
 */
describe('resolveAuthBaseUrl', () => {
  it('resolves a relative path against the document base', () => {
    expect(resolveAuthBaseUrl('/api/auth', 'http://localhost:4300/')).toBe(
      'http://localhost:4300/api/auth',
    );
  });

  it('keeps an absolute URL untouched, so auth can live on another host', () => {
    expect(resolveAuthBaseUrl('https://auth.example.com', 'http://localhost:4300/')).toBe(
      'https://auth.example.com',
    );
  });

  it('resolves against the origin even when the app is served from a sub-path', () => {
    expect(resolveAuthBaseUrl('/api/auth', 'https://example.com/dashboard/')).toBe(
      'https://example.com/api/auth',
    );
  });

  it('never returns something the URL constructor would reject', () => {
    for (const base of ['http://localhost:4300/', 'https://app.example.com/x/']) {
      expect(() => new URL(resolveAuthBaseUrl('/api/auth', base))).not.toThrow();
    }
  });
});
