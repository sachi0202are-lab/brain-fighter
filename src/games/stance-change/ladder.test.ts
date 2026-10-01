import { describe, expect, it } from 'vitest';
import { certRoundPassed, restoreParams, type RoundStats } from '../../engine/types';
import { game } from './index';
import {
  CERT_TIERS,
  certTierParams,
  clampStep,
  ladderParams,
  ladderTable,
  MAX_STEP,
  MIN_STEP,
  nearestStep,
  nextStep,
  stancePower,
} from './ladder';

/** 仕様書 6.3 の表（ステップ 1〜20） */
const SPEC_D = [2000, 1800, 1620, 1458, 1312, 1181, 1063, 957, 861, 775, 1600, 1440, 1296, 1166, 1050, 945, 850, 765, 700, 700];
const SPEC_CSI = [1000, 930, 860, 790, 720, 650, 580, 510, 440, 370, 600, 567, 534, 501, 468, 435, 402, 369, 336, 303];

const stats = (correct: number, trials = 16): RoundStats => ({ trials, correct, accuracy: correct / trials, errors: {} });

describe('難度ラダー（ステップ 1〜20）', () => {
  it('20 ステップの D と CSI が仕様書の表どおり', () => {
    const table = ladderTable();
    expect(table.map((p) => p.step)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(table.map((p) => p.D)).toEqual(SPEC_D);
    expect(table.map((p) => p.CSI)).toEqual(SPEC_CSI);
  });

  it('ステップ 1〜10 は 2 ルール、11〜20 は 3 ルール', () => {
    for (const p of ladderTable()) expect(p.rules).toBe(p.step <= 10 ? 2 : 3);
  });

  it('式どおり: D は毎ステップ ×0.9（11〜20 は下限 700）、CSI は 1〜10 で −70、11〜20 で −33（下限 300）', () => {
    for (let s = 1; s <= 10; s++) {
      expect(ladderParams(s).D).toBe(Math.round(2000 * 0.9 ** (s - 1)));
      expect(ladderParams(s).CSI).toBe(1000 - 70 * (s - 1));
    }
    for (let s = 11; s <= 20; s++) {
      expect(ladderParams(s).D).toBe(Math.max(700, Math.round(1600 * 0.9 ** (s - 11))));
      expect(ladderParams(s).CSI).toBe(Math.max(300, 600 - 33 * (s - 11)));
      expect(ladderParams(s).D).toBeGreaterThanOrEqual(700);
      expect(ladderParams(s).CSI).toBeGreaterThanOrEqual(300);
    }
    // 各帯の中で D・CSI は増えない。CSI は毎ステップ必ず減る（D が下限に張り付いても難度が上がる）
    for (let s = 2; s <= 20; s++) {
      if (s === 11) continue;
      expect(ladderParams(s).D).toBeLessThanOrEqual(ladderParams(s - 1).D);
      expect(ladderParams(s).CSI).toBeLessThan(ladderParams(s - 1).CSI);
    }
  });

  it('範囲外・小数・NaN のステップは 1..20 の整数に丸める', () => {
    expect(ladderParams(0).step).toBe(1);
    expect(ladderParams(-3).step).toBe(1);
    expect(ladderParams(25)).toEqual(ladderParams(20));
    expect(ladderParams(3.4).step).toBe(3);
    expect(ladderParams(Number.NaN).step).toBe(1);
    expect(clampStep(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it('初期値はステップ 1（2 ルール・D 2000・CSI 1000）', () => {
    expect(game.initialParams).toEqual({ step: 1, rules: 2, D: 2000, CSI: 1000 });
  });

  it('保存値からはステップだけを見てラダーの難度に戻す', () => {
    expect(restoreParams(game, { step: 7 })).toEqual(ladderParams(7));
    // 古い D・CSI やフェーズ1のスタブの保存形式 { step } でもラダーにそろう
    expect(restoreParams(game, { step: 12, rules: 2, D: 5, CSI: 5 })).toEqual(ladderParams(12));
    expect(restoreParams(game, { step: 99 })).toEqual(ladderParams(20));
    expect(restoreParams(game, { step: Number.NaN })).toEqual(ladderParams(1));
    expect(restoreParams(game, {})).toEqual(game.initialParams);
    expect(restoreParams(game, undefined)).toEqual(game.initialParams);
  });
});

describe('適応（ラウンド単位のしきい値ルール）', () => {
  it('90% → +1、80% → 維持、70% → −1', () => {
    expect(nextStep(5, 0.9)).toBe(6);
    expect(nextStep(5, 0.8)).toBe(5);
    expect(nextStep(5, 0.7)).toBe(4);
  });

  it('16 試行の境目（仕様書 v1.3）: 15 正答 +1 / 14・12 正答は維持 / 11 正答 −1', () => {
    expect(nextStep(5, 15 / 16)).toBe(6);
    expect(nextStep(5, 14 / 16)).toBe(5);
    expect(nextStep(5, 12 / 16)).toBe(5);
    expect(nextStep(5, 0.75)).toBe(5);
    expect(nextStep(5, 11 / 16)).toBe(4);
    expect(nextStep(5, 1)).toBe(6);
    expect(nextStep(5, 0)).toBe(4);
  });

  it('範囲は 1〜20（上端・下端で止まる）', () => {
    expect(nextStep(MAX_STEP, 1)).toBe(20);
    expect(nextStep(MIN_STEP, 0)).toBe(1);
    expect(nextStep(19, 0.95)).toBe(20);
    expect(nextStep(2, 0.5)).toBe(1);
  });

  it('adapt は次のステップのラダーの難度を返す（2 → 3 ルールの境目も）', () => {
    const summary = (acc: number) => ({ ...stats(Math.round(acc * 16)), accuracy: acc }) as never;
    expect(game.adapt!(ladderParams(10), summary(0.9))).toEqual(ladderParams(11));
    expect(game.adapt!(ladderParams(11), summary(0.7))).toEqual(ladderParams(10));
    expect(game.adapt!(ladderParams(11), summary(0.8))).toEqual(ladderParams(11));
  });
});

describe('戦闘力（K=20, L=ステップ, accDown=0.75, accUp=0.90）', () => {
  it('第5.1節の一般式どおり', () => {
    const f = (L: number, acc: number): number =>
      Math.round((1000 * (L - 1 + Math.min(1, Math.max(0, (acc - 0.75) / (0.9 - 0.75))))) / 20);
    for (const L of [1, 2, 7, 10, 11, 19, 20]) {
      for (const c of [0, 8, 11, 12, 13, 14, 15, 16]) {
        expect(stancePower(L, stats(c))).toBe(f(L, c / 16));
        expect(game.power(ladderParams(L), stats(c))).toBe(f(L, c / 16));
      }
    }
  });

  it('代表値: ステップ1・75% → 0、ステップ1・90% → 50、ステップ20・90% → 1000、ステップ10・82.5% → 475', () => {
    expect(stancePower(1, stats(0.75 * 40, 40))).toBe(0);
    expect(stancePower(1, stats(27, 30))).toBe(50);
    expect(stancePower(20, stats(27, 30))).toBe(1000);
    expect(stancePower(20, stats(30, 30))).toBe(1000);
    // 16 試行: 15/16（94%）は 90% 以上なので sub = 1、12/16（75%）は sub = 0
    expect(stancePower(1, stats(15))).toBe(50);
    expect(stancePower(1, stats(12))).toBe(0);
    expect(stancePower(10, stats(33, 40))).toBe(475);
    // 記録が無い（直近ラウンドなし）→ sub = 0
    expect(stancePower(5, null)).toBe(200);
  });

  it('速さに依存しない（引数に反応時間が無く、同じ正誤なら同じ値）', () => {
    const a = { ...stats(13), rtMedianMs: 300 } as RoundStats;
    const b = { ...stats(13), rtMedianMs: 1500 } as RoundStats;
    expect(game.power(ladderParams(8), a)).toBe(game.power(ladderParams(8), b));
    expect(game.power.length).toBeLessThanOrEqual(2);
  });
});

describe('認定戦の固定ティア（ルール数 / D / CSI）', () => {
  it('9 ティアが仕様書どおり', () => {
    const spec = [
      [2, 2000, 1000],
      [2, 1700, 800],
      [2, 1400, 600],
      [2, 1200, 500],
      [2, 1000, 400],
      [3, 1400, 500],
      [3, 1200, 400],
      [3, 1000, 300],
      [3, 850, 300],
    ];
    expect(CERT_TIERS).toHaveLength(9);
    spec.forEach(([rules, D, CSI], i) => {
      const p = game.certParams(i + 1);
      expect({ rules: p.rules, D: p.D, CSI: p.CSI }).toEqual({ rules, D, CSI });
      // ステップは表示用の目安（同じルール数のラダーで D が最も近い段）
      expect(p.step).toBe(nearestStep(p.rules, p.D));
      expect(p.step).toBeGreaterThanOrEqual(p.rules === 2 ? 1 : 11);
      expect(p.step).toBeLessThanOrEqual(p.rules === 2 ? 10 : 20);
    });
    // ティア 1 はラダーのステップ 1 と同じ難度
    expect(game.certParams(1)).toEqual(ladderParams(1));
  });

  it('ラダーに無い組合せも P で表せる（例: ティア 2 = 2 ルール・D 1700・CSI 800）', () => {
    const p = certTierParams(2);
    expect(ladderTable().some((l) => l.D === p.D && l.CSI === p.CSI && l.rules === p.rules)).toBe(false);
    expect(game.phases(null as never, p).map((ph) => ph.ms)).toEqual([800, 1700, 300, 500]);
  });

  it('範囲外のティアは端に丸める', () => {
    expect(certTierParams(0)).toEqual(certTierParams(1));
    expect(certTierParams(12)).toEqual(certTierParams(9));
  });

  it('合格は 16 試行中 13 正答以上（既定の 79% ルール。仕様書 v1.3）', () => {
    expect(certRoundPassed(game, stats(13), 3)).toBe(true);
    expect(certRoundPassed(game, stats(12), 3)).toBe(false);
  });
});
