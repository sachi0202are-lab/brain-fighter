/**
 * 難度ラダー・適応ルール・認定戦のティア・戦闘力（仕様書 6.3 / 5.1）。どれも純粋関数。
 *
 * ラダー（ステップ 1〜20）
 * - 1〜10: 2 ルール。D = 2000 ms から毎ステップ 10% 減、CSI = 1000 ms から毎ステップ 70 ms 減（1000 → 370）
 * - 11〜20: 3 ルール。D = 1600 ms から毎ステップ 10% 減（下限 700）、CSI = 600 ms から毎ステップ 33 ms 減（下限 300）
 * 適応（ラウンド末）: 正答率 ≥ 90% → +1、75〜89% → 維持、< 75% → −1。範囲 1〜20。初期ステップ 1。
 * 割合のルールなので試行数によらない（16 試行では 15/16 以上で +1、12〜14 で維持、11 以下で −1）。
 */
import { blockPower } from '../../engine/power';
import { blockThresholdStep, clamp, type BlockRuleConfig } from '../../engine/staircase';
import type { RoundStats } from '../../engine/types';
import type { ScParams } from './model';

export const MIN_STEP = 1;
export const MAX_STEP = 20;
/** ステップ 1..TWO_RULE_STEPS は 2 ルール、それより上は 3 ルール */
export const TWO_RULE_STEPS = 10;

/** 仕様書 6.3 のラダーの係数 */
export const LADDER = {
  twoRules: { D0: 2000, CSI0: 1000, csiStep: 70 },
  threeRules: { D0: 1600, CSI0: 600, csiStep: 33, Dmin: 700, CSImin: 300 },
  /** D の毎ステップの倍率（10% 減） */
  dRatio: 0.9,
} as const;

/** ラウンド単位のしきい値ルール（staircase.ts のブロック規則に渡す） */
export const STEP_RULE: BlockRuleConfig = { promoteAt: 0.9, demoteBelow: 0.75, min: MIN_STEP, max: MAX_STEP };

/** 戦闘力の一般式の定数（K = 20、accDown = 0.75、accUp = 0.90） */
export const POWER_RULE = { levels: MAX_STEP, accDown: 0.75, accUp: 0.9 } as const;

/** ステップを整数にして 1..20 に収める（NaN は 1） */
export function clampStep(step: number): number {
  if (!Number.isFinite(step)) return MIN_STEP;
  return clamp(Math.round(step), MIN_STEP, MAX_STEP);
}

/** ステップ → そのステップの難度（ルール数・D・CSI） */
export function ladderParams(step: number): ScParams {
  const s = clampStep(step);
  if (s <= TWO_RULE_STEPS) {
    const k = s - 1;
    const c = LADDER.twoRules;
    return { step: s, rules: 2, D: Math.round(c.D0 * LADDER.dRatio ** k), CSI: c.CSI0 - c.csiStep * k };
  }
  const k = s - TWO_RULE_STEPS - 1;
  const c = LADDER.threeRules;
  return {
    step: s,
    rules: 3,
    D: Math.max(c.Dmin, Math.round(c.D0 * LADDER.dRatio ** k)),
    CSI: Math.max(c.CSImin, c.CSI0 - c.csiStep * k),
  };
}

/** ラダー全体（ステップ 1..20） */
export function ladderTable(): ScParams[] {
  const out: ScParams[] = [];
  for (let s = MIN_STEP; s <= MAX_STEP; s++) out.push(ladderParams(s));
  return out;
}

/** ラウンドの正答率から次のステップ（≥ 90% で +1 / < 75% で −1 / それ以外は維持、1..20） */
export function nextStep(step: number, accuracy: number): number {
  return blockThresholdStep(clampStep(step), accuracy, STEP_RULE);
}

/** 戦闘力 = round(1000 × ((L − 1) + sub) / 20)、sub = clamp((acc − 0.75) / (0.90 − 0.75), 0, 1)。速さは使わない */
export function stancePower(step: number, last: RoundStats | null): number {
  return blockPower({
    level: clampStep(step),
    levels: POWER_RULE.levels,
    acc: last?.accuracy ?? 0,
    accDown: POWER_RULE.accDown,
    accUp: POWER_RULE.accUp,
  });
}

/** 認定戦の固定ティア（ルール数 / D / CSI）。仕様書 6.3 */
export const CERT_TIERS: readonly { rules: number; D: number; CSI: number }[] = [
  { rules: 2, D: 2000, CSI: 1000 },
  { rules: 2, D: 1700, CSI: 800 },
  { rules: 2, D: 1400, CSI: 600 },
  { rules: 2, D: 1200, CSI: 500 },
  { rules: 2, D: 1000, CSI: 400 },
  { rules: 3, D: 1400, CSI: 500 },
  { rules: 3, D: 1200, CSI: 400 },
  { rules: 3, D: 1000, CSI: 300 },
  { rules: 3, D: 850, CSI: 300 },
];

/**
 * 同じルール数のラダーの中で D が最も近いステップ（同じ近さなら易しい方）。
 * 認定戦の難度はラダーに無い組合せなので、敵レベルの表示にだけこの目安を使う。
 */
export function nearestStep(rules: number, D: number): number {
  let best = rules >= 3 ? TWO_RULE_STEPS + 1 : MIN_STEP;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const p of ladderTable()) {
    if ((p.rules >= 3) !== (rules >= 3)) continue;
    const err = Math.abs(p.D - D);
    if (err < bestErr) {
      best = p.step;
      bestErr = err;
    }
  }
  return best;
}

/** 認定戦のティア（1..9。範囲外は端に丸める）の難度。ステップは適応させない（表示用の目安だけ） */
export function certTierParams(tier: number): ScParams {
  const idx = clamp(Number.isFinite(tier) ? Math.round(tier) : 1, 1, CERT_TIERS.length) - 1;
  const t = CERT_TIERS[idx] as (typeof CERT_TIERS)[number];
  return { step: nearestStep(t.rules, t.D), rules: t.rules, D: t.D, CSI: t.CSI };
}
