import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';
import {
  blockDecision,
  blockThresholdStep,
  equilibriumAccuracy,
  nbackStep,
  presentedValue,
  upDownStep,
  weightedStep,
  type BlockRuleConfig,
  type UpDownConfig,
  type WeightedStaircaseConfig,
} from './staircase';
import { frameQuantizer } from './timing';

/** 仕様書 6.1 の値 */
const DH: WeightedStaircaseConfig = { onCorrect: 0.93, onError: 1.25, min: 33, max: 500 };

describe('(a) 乗算型の重み付き階段法', () => {
  it('正答で ×0.93、誤答で ×1.25', () => {
    expect(weightedStep(300, true, DH).value).toBeCloseTo(279, 10);
    expect(weightedStep(300, false, DH).value).toBeCloseTo(375, 10);
  });

  it('範囲 33〜500 ms にクランプされる', () => {
    let t = 300;
    for (let k = 0; k < 200; k++) t = weightedStep(t, true, DH).value;
    expect(t).toBe(33);
    for (let k = 0; k < 200; k++) t = weightedStep(t, false, DH).value;
    expect(t).toBe(500);
  });

  it('ランダムな正誤の系列でも T は常に 33〜500 ms', () => {
    const r = mulberry32(11);
    let t = 300;
    for (let k = 0; k < 20000; k++) {
      t = weightedStep(t, r.chance(0.6), DH).value;
      expect(t).toBeGreaterThanOrEqual(33);
      expect(t).toBeLessThanOrEqual(500);
    }
  });

  it('量子化フックは提示値だけに効き、内部値は連続のまま（1フレーム未満の変化で張り付かない）', () => {
    const cfg = { ...DH, quantize: frameQuantizer(1000 / 60) };
    const s = weightedStep(40, true, cfg);
    expect(s.value).toBeCloseTo(37.2, 10);
    expect(s.presented).toBeCloseTo(33.333, 3); // 2 フレーム
    expect(presentedValue(300, cfg)).toBeCloseTo(300, 6); // 18 フレーム
    // 下限付近で誤答→正答を繰り返しても内部値は動く
    let v = 33;
    v = weightedStep(v, false, cfg).value;
    expect(v).toBeCloseTo(41.25, 10);
    v = weightedStep(v, true, cfg).value;
    expect(v).toBeCloseTo(38.3625, 10);
  });

  it('収束正答率は約 75%（0.93 / 1.25）', () => {
    expect(equilibriumAccuracy(DH)).toBeCloseTo(0.7546, 3);
  });

  it('正答 75%・誤答 25%（正正正誤の繰り返し）で T が安定する（受け入れ基準 3）', () => {
    let t = 200;
    const seen: number[] = [];
    for (let k = 0; k < 100; k++) {
      t = weightedStep(t, k % 4 !== 3, DH).value;
      seen.push(t);
    }
    // 100 試行後も開始値の ±20% 以内、途中も 33〜500 の内側で振れ幅が小さい
    expect(t / 200).toBeGreaterThan(0.8);
    expect(t / 200).toBeLessThan(1.2);
    expect(Math.min(...seen)).toBeGreaterThan(140);
    expect(Math.max(...seen)).toBeLessThan(260);
  });

  it('心理測定関数を持つ疑似プレイヤーでは、正答率 約 75% の T に収束する', () => {
    // 2択×8方向の当て推量 1/16、しきい値 alpha = 120 ms、傾き 2（Weibull）
    const guess = 1 / 16;
    const pCorrect = (T: number): number => guess + (1 - guess) * (1 - Math.exp(-((T / 120) ** 2)));
    const r = mulberry32(2026);
    let t = 300;
    const tail: { t: number; c: boolean }[] = [];
    for (let k = 0; k < 4000; k++) {
      const c = r.chance(pCorrect(t));
      if (k >= 2000) tail.push({ t, c });
      t = weightedStep(t, c, DH).value;
    }
    const acc = tail.filter((x) => x.c).length / tail.length;
    const geoMean = Math.exp(tail.reduce((a, x) => a + Math.log(x.t), 0) / tail.length);
    expect(acc).toBeGreaterThan(0.71);
    expect(acc).toBeLessThan(0.8);
    // 理論値: pCorrect(T*) = 0.7546 → T* ≈ 139 ms
    expect(geoMean).toBeGreaterThan(115);
    expect(geoMean).toBeLessThan(165);
  });
});

describe('(b) ブロック単位のしきい値ルール（スタンスチェンジ: ≥90% 昇格 / 75〜89% 維持 / <75% 降格）', () => {
  const SC: BlockRuleConfig = { promoteAt: 0.9, demoteBelow: 0.75, min: 1, max: 20 };

  it('境界値', () => {
    expect(blockDecision(27 / 30, SC)).toBe('up');
    expect(blockDecision(0.9, SC)).toBe('up');
    expect(blockDecision(26 / 30, SC)).toBe('stay');
    expect(blockDecision(0.75, SC)).toBe('stay');
    expect(blockDecision(23 / 30, SC)).toBe('stay');
    expect(blockDecision(22 / 30, SC)).toBe('down');
    expect(blockDecision(0.7499, SC)).toBe('down');
  });

  it('ステップの増減と範囲 1〜20', () => {
    expect(blockThresholdStep(5, 1, SC)).toBe(6);
    expect(blockThresholdStep(5, 0.8, SC)).toBe(5);
    expect(blockThresholdStep(5, 0.5, SC)).toBe(4);
    expect(blockThresholdStep(20, 1, SC)).toBe(20);
    expect(blockThresholdStep(1, 0, SC)).toBe(1);
    expect(blockThresholdStep(3, 1, { ...SC, step: 2 })).toBe(5);
  });
});

describe('(c) n-back 用ルール（誤り < 3 で +1 / > 5 で −1、n は 1〜9）', () => {
  it('誤りの数ごと', () => {
    expect(nbackStep(3, 0)).toBe(4);
    expect(nbackStep(3, 2)).toBe(4);
    expect(nbackStep(3, 3)).toBe(3);
    expect(nbackStep(3, 5)).toBe(3);
    expect(nbackStep(3, 6)).toBe(2);
    expect(nbackStep(3, 20)).toBe(2);
  });

  it('範囲 1〜9', () => {
    expect(nbackStep(9, 0)).toBe(9);
    expect(nbackStep(1, 10)).toBe(1);
  });
});

describe('(d) 2-down/1-up', () => {
  const cfg: UpDownConfig = { down: 2, harderStep: 1, easierStep: -1, min: 1, max: 10 };

  it('2回連続正答で難しく、1回の誤答で易しく', () => {
    let s = { level: 5, streak: 0 };
    s = upDownStep(s, true, cfg);
    expect(s).toEqual({ level: 5, streak: 1 });
    s = upDownStep(s, true, cfg);
    expect(s).toEqual({ level: 6, streak: 0 });
    s = upDownStep(s, true, cfg);
    s = upDownStep(s, false, cfg);
    expect(s).toEqual({ level: 5, streak: 0 });
  });

  it('範囲でクランプ、提示時間のように「短くすると難しい」向きにも使える', () => {
    expect(upDownStep({ level: 10, streak: 1 }, true, cfg).level).toBe(10);
    expect(upDownStep({ level: 1, streak: 0 }, false, cfg).level).toBe(1);
    const ms: UpDownConfig = { down: 2, harderStep: -10, easierStep: 10, min: 50, max: 500 };
    expect(upDownStep({ level: 200, streak: 1 }, true, ms).level).toBe(190);
    expect(upDownStep({ level: 200, streak: 1 }, false, ms).level).toBe(210);
  });

  it('疑似プレイヤーで約 70.7% に収束する', () => {
    // レベルが上がるほど正答率が下がる観測者
    const p = (level: number): number => 1 / (1 + Math.exp((level - 20) / 3));
    const r = mulberry32(8);
    const big: UpDownConfig = { down: 2, harderStep: 1, easierStep: -1, min: 1, max: 60 };
    let s = { level: 5, streak: 0 };
    let correct = 0;
    let n = 0;
    for (let k = 0; k < 30000; k++) {
      const c = r.chance(p(s.level));
      if (k >= 5000) {
        n++;
        if (c) correct++;
      }
      s = upDownStep(s, c, big);
    }
    expect(correct / n).toBeGreaterThan(0.68);
    expect(correct / n).toBeLessThan(0.73);
  });
});
