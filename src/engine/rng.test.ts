import { describe, expect, it } from 'vitest';
import { hashSeed, mulberry32, parseSeed, roundSeed } from './rng';

describe('mulberry32', () => {
  it('同じシードなら同じ系列', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 20 }, () => a.next());
    const ys = Array.from({ length: 20 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it('違うシードなら違う系列', () => {
    const a = Array.from({ length: 5 }, mulberry32(1).next);
    const b = Array.from({ length: 5 }, mulberry32(2).next);
    expect(a).not.toEqual(b);
  });

  it('next は [0, 1)、int は [min, max)', () => {
    const r = mulberry32(7);
    for (let k = 0; k < 10000; k++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      const n = r.int(3, 8);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThan(8);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it('int のすべての値がおおよそ均等に出る', () => {
    const r = mulberry32(99);
    const counts = new Array(8).fill(0);
    for (let k = 0; k < 80000; k++) counts[r.int(0, 8)]++;
    for (const c of counts) expect(Math.abs(c - 10000)).toBeLessThan(500);
  });

  it('shuffle は並べ替え（要素は同じ）で、シードで決まる', () => {
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const a = mulberry32(5).shuffle(items);
    const b = mulberry32(5).shuffle(items);
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual(items);
    expect(items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('pick は空配列で例外、fork は親の消費量に依存しない', () => {
    expect(() => mulberry32(1).pick([])).toThrow();
    const p1 = mulberry32(10);
    const p2 = mulberry32(10);
    p2.next();
    p2.next();
    expect(p1.fork('x').next()).toBe(p2.fork('x').next());
    expect(p1.fork('x').next()).not.toBe(p1.fork('y').next());
  });
});

describe('シードの扱い', () => {
  it('hashSeed は決定的で、並びが違えば別の値', () => {
    expect(hashSeed('a', 1)).toBe(hashSeed('a', 1));
    expect(hashSeed('a', 1)).not.toBe(hashSeed('a', 2));
    expect(hashSeed('a', 1)).not.toBe(hashSeed(1, 'a'));
    expect(hashSeed('x')).toBeGreaterThanOrEqual(0);
    expect(hashSeed('x')).toBeLessThan(2 ** 32);
  });

  it('URL の ?seed= を読む', () => {
    expect(parseSeed('?seed=123')).toBe(123);
    expect(parseSeed('?test=1&seed=7')).toBe(7);
    expect(parseSeed('?seed=abc')).toBe(hashSeed('abc'));
    expect(parseSeed('?seed=')).toBeNull();
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('?test=1')).toBeNull();
  });

  it('roundSeed: 固定シードなら決定的、無ければ毎回ランダム', () => {
    expect(roundSeed(5, 'double-hit', 'round', 1)).toBe(roundSeed(5, 'double-hit', 'round', 1));
    expect(roundSeed(5, 'double-hit', 'round', 1)).not.toBe(roundSeed(5, 'double-hit', 'round', 2));
    const xs = new Set(Array.from({ length: 5 }, () => roundSeed(null, 'double-hit', 'round', 1)));
    expect(xs.size).toBeGreaterThan(1);
  });
});
