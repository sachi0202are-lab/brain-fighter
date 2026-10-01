import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';
import { balancedCounts, balancedSequence, maxRunLength, randomSequence } from './sequence';

const count = <T>(xs: T[], v: T): number => xs.filter((x) => x === v).length;

describe('系列の生成', () => {
  it('maxRunLength', () => {
    expect(maxRunLength([])).toBe(0);
    expect(maxRunLength([1])).toBe(1);
    expect(maxRunLength([1, 1, 2, 2, 2, 1])).toBe(3);
  });

  it('balancedCounts は合計 n で差は最大 1', () => {
    const c = balancedCounts(mulberry32(1), 26, 8);
    expect(c.reduce((a, b) => a + b, 0)).toBe(26);
    expect(Math.max(...c) - Math.min(...c)).toBeLessThanOrEqual(1);
  });

  it('8方向・24 試行・同一方向の連続は 2 回まで（ダブルヒットの火花）', () => {
    for (let seed = 0; seed < 200; seed++) {
      const seq = balancedSequence(mulberry32(seed), 24, [0, 1, 2, 3, 4, 5, 6, 7], 2);
      expect(seq).toHaveLength(24);
      expect(maxRunLength(seq)).toBeLessThanOrEqual(2);
      for (let d = 0; d < 8; d++) expect(count(seq, d)).toBe(3);
    }
  });

  it('2値・16 試行・連続 4 回まで', () => {
    for (let seed = 0; seed < 200; seed++) {
      const seq = balancedSequence(mulberry32(seed), 16, ['A', 'B'], 4);
      expect(maxRunLength(seq)).toBeLessThanOrEqual(4);
      expect(count(seq, 'A')).toBe(8);
    }
  });

  it('同じシードなら同じ系列、予測可能な固定パターンにならない', () => {
    const a = balancedSequence(mulberry32(3), 24, [0, 1, 2, 3, 4, 5, 6, 7], 2);
    const b = balancedSequence(mulberry32(3), 24, [0, 1, 2, 3, 4, 5, 6, 7], 2);
    const c = balancedSequence(mulberry32(4), 24, [0, 1, 2, 3, 4, 5, 6, 7], 2);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('randomSequence も連続の上限を守る', () => {
    for (let seed = 0; seed < 100; seed++) {
      const seq = randomSequence(mulberry32(seed), 50, [0, 1, 2], 2);
      expect(maxRunLength(seq)).toBeLessThanOrEqual(2);
    }
  });
});
