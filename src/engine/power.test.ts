import { describe, expect, it } from 'vitest';
import { blockPower, doubleHitPower, normalizePower, totalPower } from './power';

describe('戦闘力の一般式（仕様書 5.1）', () => {
  it('スタンスチェンジ: K=20, accDown=0.75, accUp=0.90', () => {
    // sub = (0.8 - 0.75) / 0.15 = 1/3 → 1000 × (6 + 1/3) / 20 = 316.67
    expect(blockPower({ level: 7, levels: 20, acc: 0.8, accDown: 0.75, accUp: 0.9 })).toBe(317);
    expect(blockPower({ level: 7, levels: 20, acc: 0.95, accDown: 0.75, accUp: 0.9 })).toBe(350);
    expect(blockPower({ level: 7, levels: 20, acc: 0.5, accDown: 0.75, accUp: 0.9 })).toBe(300);
    expect(blockPower({ level: 1, levels: 20, acc: 0.5, accDown: 0.75, accUp: 0.9 })).toBe(0);
    expect(blockPower({ level: 20, levels: 20, acc: 1, accDown: 0.75, accUp: 0.9 })).toBe(1000);
  });

  it('コンボ・リコール: K=9、acc = 1 − 誤り/(20+n)、accDown = 1 − 5/(20+n)、accUp = 1 − 2/(20+n)', () => {
    const n = 3;
    const N = 20 + n;
    const at = (errors: number): number =>
      blockPower({ level: n, levels: 9, acc: 1 - errors / N, accDown: 1 - 5 / N, accUp: 1 - 2 / N });
    expect(at(4)).toBe(259); // sub = 1/3
    expect(at(5)).toBe(222); // sub = 0
    expect(at(2)).toBe(333); // sub = 1
    expect(at(0)).toBe(333);
    expect(at(9)).toBe(222);
  });

  it('レベルをまたいでも連続（L の上限 = L+1 の下限）', () => {
    const top = blockPower({ level: 4, levels: 20, acc: 0.9, accDown: 0.75, accUp: 0.9 });
    const bottom = blockPower({ level: 5, levels: 20, acc: 0.75, accDown: 0.75, accUp: 0.9 });
    expect(top).toBe(bottom);
  });
});

describe('ダブルヒットの式（仕様書 6.1）', () => {
  it('端点: stage 0, T=500 → 0。stage 4, T=33 → 1000', () => {
    expect(doubleHitPower(0, 500)).toBe(0);
    expect(doubleHitPower(4, 33)).toBe(1000);
  });

  it('途中の値', () => {
    // 200 × 2 + 200 × ln(5) / ln(500/33) = 400 + 118.4
    expect(doubleHitPower(2, 100)).toBe(518);
    expect(doubleHitPower(0, 33)).toBe(200);
    expect(doubleHitPower(1, 500)).toBe(200);
  });

  it('T が短いほど高く、範囲外の T はクランプ、0〜1000 に収まる', () => {
    let prev = -1;
    for (let t = 500; t >= 33; t -= 1) {
      const p = doubleHitPower(1, t);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
    expect(doubleHitPower(0, 1000)).toBe(0);
    expect(doubleHitPower(4, 10)).toBe(1000);
  });
});

describe('総合戦闘力', () => {
  it('3ゲームの合計（各 0〜1000 の整数に正規化）', () => {
    expect(totalPower([100, 200, 300])).toBe(600);
    expect(totalPower([1000, 1000, 1000])).toBe(3000);
    expect(totalPower([1200.4, -3, Number.NaN])).toBe(1000);
    expect(normalizePower(512.6)).toBe(513);
  });
});
