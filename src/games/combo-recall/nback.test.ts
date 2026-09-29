/** 系列生成（仕様書 6.2「系列」）のテスト */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import {
  BASE_TRIALS,
  classify,
  clampN,
  generateSequence,
  LURE_RATIO_MAX,
  LURE_RATIO_MIN,
  longestRun,
  lureCount,
  MAX_RUN,
  POSITIONS,
  TARGETS,
  trialCount,
  type NBackItem,
} from './nback';

// 並行作業で CPU が詰まった環境でも時間切れにしない（どのテストも通常は 1 秒未満）
vi.setConfig({ testTimeout: 60_000 });

const NS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
/** n ごとに調べるシードの数 */
const SEEDS = 300;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('試行数とルアーの数', () => {
  it('1ラウンド = 20 + n 試行', () => {
    for (const n of NS) expect(trialCount(n)).toBe(20 + n);
  });

  it('ルアーは n ≥ 3 で試行数の 10〜15%、n ≤ 2 は入れない', () => {
    expect(lureCount(1)).toBe(0);
    expect(lureCount(2)).toBe(0);
    for (const n of NS.filter((k) => k >= 3)) {
      const ratio = lureCount(n) / trialCount(n);
      expect(ratio).toBeGreaterThanOrEqual(LURE_RATIO_MIN);
      expect(ratio).toBeLessThanOrEqual(LURE_RATIO_MAX);
    }
    // 23〜26 試行は 3 個（11.5〜13.0%）、27 試行は 3 個（11.1%）、28・29 試行は 4 個（14.3%・13.8%）
    expect(NS.map(lureCount)).toEqual([0, 0, 3, 3, 3, 3, 3, 4, 4]);
  });

  it('n は 1〜9 の整数にそろえる', () => {
    expect(clampN(0)).toBe(1);
    expect(clampN(-3)).toBe(1);
    expect(clampN(12)).toBe(9);
    expect(clampN(2.6)).toBe(3);
    expect(clampN(Number.NaN)).toBe(1);
  });
});

describe('n 個前の一致判定（classify）', () => {
  it('n = 2 の手書きの例', () => {
    //            0  1  2  3  4  5  6  7
    const pos = [0, 1, 0, 2, 3, 2, 2, 5];
    const c = classify(pos, 2);
    // 標的: 2（0 と 0）、5（3 と 5 がともに 2）
    expect(c.map((x) => x.target)).toEqual([false, false, true, false, false, true, false, false]);
    // ルアー（標的でなく、1 個前か 3 個前と同じ）: 6（1 個前の 5 と同じ 2）
    expect(c.map((x) => x.lure)).toEqual([false, false, false, false, false, false, true, false]);
  });

  it('n = 3 の手書きの例（n−1 = 2 個前・n+1 = 4 個前がルアー）', () => {
    //            0  1  2  3  4  5  6  7
    const pos = [4, 1, 2, 4, 1, 1, 2, 0];
    const c = classify(pos, 3);
    // 3: 0 番と同じ 4 → 標的。4: 1 番と同じ 1 → 標的
    expect(c.map((x) => x.target)).toEqual([false, false, false, true, true, false, false, false]);
    // 5: 2 個前（3 番 = 4）とは違い、4 個前（1 番 = 1）と同じ → ルアー。6: 2 個前（4 番 = 1）違い、4 個前（2 番 = 2）と同じ → ルアー
    expect(c.map((x) => x.lure)).toEqual([false, false, false, false, false, true, true, false]);
  });

  it('n = 1 は 0 個前を数えない（2 個前との一致だけがルアー）', () => {
    const c = classify([3, 3, 5, 3], 1);
    expect(c.map((x) => x.target)).toEqual([false, true, false, false]);
    expect(c.map((x) => x.lure)).toEqual([false, false, false, true]);
  });
});

describe.each(NS)('n = %i の系列', (n) => {
  const seqs = Array.from({ length: SEEDS }, (_, s) => generateSequence(n, mulberry32(1000 * n + s)));
  /** 条件を満たさない系列のシード番号（assert は 1 回にまとめる。数万回の expect を避けて負荷の高い環境でも速く） */
  const violations = (ok: (seq: NBackItem[]) => boolean): number[] => seqs.flatMap((seq, s) => (ok(seq) ? [] : [s]));
  const positions = (seq: NBackItem[]): number[] => seq.map((x) => x.pos);
  /** 標的の添字（標的を置ける 20 試行の中での位置 0..19） */
  const targetOffsets = (seq: NBackItem[]): number[] => seq.flatMap((x, i) => (x.target ? [i - n] : []));

  it('長さ 20 + n、位置は 0..7 の整数', () => {
    expect(violations((seq) => seq.length === BASE_TRIALS + n && seq.every((x) => Number.isInteger(x.pos) && x.pos >= 0 && x.pos < POSITIONS))).toEqual([]);
  });

  it('標的はちょうど 6 個で、フラグは「n 個前と同じ位置」と一致する（n 個目より前に標的は無い）', () => {
    expect(
      violations((seq) => {
        const pos = positions(seq);
        return seq.every((x, i) => x.target === (i >= n && pos[i - n] === pos[i])) && seq.filter((x) => x.target).length === TARGETS;
      }),
    ).toEqual([]);
  });

  it('ルアーのフラグは「n±1 個前と同じで n 個前とは違う」と一致する', () => {
    expect(
      violations((seq) => {
        const pos = positions(seq);
        return seq.every((x, i) => {
          const near = (n >= 2 && i >= n - 1 && pos[i - (n - 1)] === x.pos) || (i >= n + 1 && pos[i - (n + 1)] === x.pos);
          return x.lure === (!x.target && near);
        });
      }),
    ).toEqual([]);
    // classify（ログの読み取りにも使う判定）とも一致
    expect(violations((seq) => classify(positions(seq), n).every((c, i) => c.lure === seq[i]!.lure && c.target === seq[i]!.target))).toEqual([]);
  });

  if (n >= 3) {
    it('ルアーは試行数の 10〜15%（ちょうど lureCount 個。偶然の一致で増えない）', () => {
      const want = lureCount(n);
      expect(want / (BASE_TRIALS + n)).toBeGreaterThanOrEqual(LURE_RATIO_MIN);
      expect(want / (BASE_TRIALS + n)).toBeLessThanOrEqual(LURE_RATIO_MAX);
      expect(violations((seq) => seq.filter((x) => x.lure).length === want)).toEqual([]);
    });

    it('ルアーには n−1 個前と n+1 個前の両方の型が出る', () => {
      let minus = 0;
      let plus = 0;
      for (const seq of seqs) {
        const pos = positions(seq);
        seq.forEach((x, i) => {
          if (!x.lure) return;
          if (pos[i - (n - 1)] === x.pos) minus += 1;
          if (i >= n + 1 && pos[i - (n + 1)] === x.pos) plus += 1;
        });
      }
      const total = SEEDS * lureCount(n);
      expect(minus / total).toBeGreaterThan(0.3);
      expect(plus / total).toBeGreaterThan(0.3);
    });
  }

  it(`同じマスの連続は ${MAX_RUN} 回まで`, () => {
    expect(violations((seq) => longestRun(positions(seq)) <= MAX_RUN)).toEqual([]);
  });

  it('標的は系列の前・中・後（標的を置ける 20 試行の 3 分割）に 2 個ずつ', () => {
    expect(
      violations((seq) => {
        const idx = targetOffsets(seq);
        return idx.filter((k) => k < 7).length === 2 && idx.filter((k) => k >= 7 && k < 14).length === 2 && idx.filter((k) => k >= 14).length === 2;
      }),
    ).toEqual([]);
  });

  it('標的の位置（マス）は 6 個とも別のマス、全体では 8 マスにほぼ均等', () => {
    expect(violations((seq) => new Set(seq.filter((x) => x.target).map((x) => x.pos)).size === TARGETS)).toEqual([]);
    const perCell = new Array<number>(POSITIONS).fill(0);
    for (const seq of seqs) for (const x of seq) if (x.target) perCell[x.pos] = (perCell[x.pos] as number) + 1;
    const expected = (SEEDS * TARGETS) / POSITIONS;
    expect(perCell.every((c) => c > expected * 0.8 && c < expected * 1.2)).toBe(true);
  });

  it('標的の時刻は 20 試行のどこにでも出る（固定の並びにならない）', () => {
    const seen = new Set<number>();
    const patterns = new Set<string>();
    for (const seq of seqs) {
      const idx = targetOffsets(seq);
      for (const k of idx) seen.add(k);
      patterns.add(idx.join(','));
    }
    expect(seen.size).toBe(BASE_TRIALS);
    // 並びの種類は千を超えるので、大半が別の並びになる（同じ並びの繰り返しにならない）
    expect(patterns.size).toBeGreaterThan(SEEDS * 0.75);
  });
});

describe('乱数', () => {
  it('同じシードなら同じ系列、違うシードなら違う系列', () => {
    for (const n of NS) {
      expect(generateSequence(n, mulberry32(5))).toEqual(generateSequence(n, mulberry32(5)));
      expect(generateSequence(n, mulberry32(5))).not.toEqual(generateSequence(n, mulberry32(6)));
    }
  });

  it('Math.random を使わない（rng だけ）', () => {
    const spy = vi.spyOn(Math, 'random');
    for (const n of NS) generateSequence(n, mulberry32(n));
    expect(spy).not.toHaveBeenCalled();
  });
});
