import { describe, expect, it } from 'vitest';
import { buildObjectKey, slugify } from './object-key';

describe('slugify', () => {
  it('strips the characters that would let a key escape its tenant prefix', () => {
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('a/b\\c')).toBe('a-b-c');
  });

  it('keeps a readable name for accented and spaced input', () => {
    expect(slugify('Relazione Finanziaria 2026')).toBe('relazione-finanziaria-2026');
    expect(slugify('perché però')).toBe('perche-pero');
  });

  it('still produces a slug when nothing survives', () => {
    expect(slugify('日本語')).toBe('file');
    expect(slugify('   ')).toBe('file');
  });
});

describe('buildObjectKey', () => {
  const now = new Date('2026-03-09T10:00:00Z');

  it('leads with the tenant id, then the date', () => {
    const key = buildObjectKey({ organizationId: 'org_123', fileName: 'report.pdf', now });
    expect(key.startsWith('org_123/2026/03/')).toBe(true);
    expect(key.endsWith('-report.pdf')).toBe(true);
  });

  it('never collides for two files with the same name', () => {
    const input = { organizationId: 'org_123', fileName: 'report.pdf', now };
    expect(buildObjectKey(input)).not.toBe(buildObjectKey(input));
  });

  it('cannot be talked out of the tenant prefix by the file name', () => {
    const key = buildObjectKey({
      organizationId: 'org_a',
      fileName: '../../org_b/secret.pdf',
      now,
    });
    // Three segments of ours plus the name: nothing the caller wrote added a level.
    expect(key.split('/')).toHaveLength(4);
    expect(key.startsWith('org_a/')).toBe(true);
  });

  it('keeps a hostile extension from reintroducing a path', () => {
    const key = buildObjectKey({ organizationId: 'o', fileName: 'x.p df/../y', now });
    expect(key).not.toContain('..');
    expect(key.split('/')).toHaveLength(4);
  });

  it('handles a name with no extension', () => {
    const key = buildObjectKey({ organizationId: 'o', fileName: 'Makefile', now });
    expect(key.endsWith('-makefile')).toBe(true);
  });
});
