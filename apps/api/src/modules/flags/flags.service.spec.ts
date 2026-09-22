import { describe, expect, it } from 'vitest';
import { bucket } from './flags.service';

/**
 * The rollout bucket. A gradual rollout is only gradual if the same subject keeps the
 * same answer — a random draw per request would move users in and out of the feature
 * while they use it, and the bug reports would describe a product changing shape.
 */
describe('rollout bucket', () => {
  it('always lands in 0..99', () => {
    for (let i = 0; i < 500; i++) {
      const value = bucket('some.flag', `subject-${i}`);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(100);
    }
  });

  it('is stable for the same flag and subject', () => {
    expect(bucket('some.flag', 'org-1')).toBe(bucket('some.flag', 'org-1'));
  });

  it('is independent between flags, so a 10% rollout is not always the same 10%', () => {
    const subjects = Array.from({ length: 200 }, (_, i) => `org-${i}`);
    const a = subjects.filter((s) => bucket('flag.a', s) < 10);
    const b = subjects.filter((s) => bucket('flag.b', s) < 10);

    // Not disjoint — that would be its own kind of suspicious — just not identical.
    expect(a).not.toEqual(b);
  });

  it('spreads subjects across the range rather than clumping', () => {
    const subjects = Array.from({ length: 1000 }, (_, i) => `org-${i}`);
    const inFirstTenth = subjects.filter((s) => bucket('some.flag', s) < 10).length;

    // 10% of 1000 with generous slack: this asserts "not obviously broken", not that
    // SHA-256 is uniform. A hash that returned a constant would land here.
    expect(inFirstTenth).toBeGreaterThan(50);
    expect(inFirstTenth).toBeLessThan(160);
  });
});
