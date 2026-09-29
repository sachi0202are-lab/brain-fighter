/**
 * 戦闘力（仕様書 第5.1節・第6.1節）。
 *
 * MUST: 速さはスコアに一切影響しない。ここの関数は反応時間を引数に取らない。
 */
import { clamp } from './staircase';

export const POWER_MAX = 1000;

export interface BlockPowerInput {
  /** L = 現在のステップ（1..K） */
  level: number;
  /** K = ステップ数 */
  levels: number;
  /** 直近ラウンドの正答率 */
  acc: number;
  /** 降格しきい値 */
  accDown: number;
  /** 昇格しきい値 */
  accUp: number;
}

/**
 * ブロック適応のゲームの一般式:
 * sub = clamp((acc − accDown) / (accUp − accDown), 0, 1)、戦闘力 = round(1000 × ((L − 1) + sub) / K)
 */
export function blockPower({ level, levels, acc, accDown, accUp }: BlockPowerInput): number {
  const sub = accUp > accDown ? clamp((acc - accDown) / (accUp - accDown), 0, 1) : acc >= accUp ? 1 : 0;
  return clamp(Math.round((POWER_MAX * (level - 1 + sub)) / levels), 0, POWER_MAX);
}

export interface DoubleHitPowerOptions {
  /** T の上限（戦闘力 0 側） */
  tMax: number;
  /** T の下限（戦闘力が満点側） */
  tMin: number;
  /** 1ステージの重み */
  stageWeight: number;
}

export const DOUBLE_HIT_POWER: DoubleHitPowerOptions = { tMax: 500, tMin: 33, stageWeight: 200 };

/**
 * ダブルヒット: round(200 × stage + 200 × ln(500 / T) / ln(500 / 33)) を 0〜1000 に丸める。
 * stage 0, T=500 → 0。stage 4, T=33 → 1000。
 */
export function doubleHitPower(stage: number, T: number, opt: DoubleHitPowerOptions = DOUBLE_HIT_POWER): number {
  const t = clamp(T, opt.tMin, opt.tMax);
  const v = opt.stageWeight * stage + (opt.stageWeight * Math.log(opt.tMax / t)) / Math.log(opt.tMax / opt.tMin);
  return clamp(Math.round(v), 0, POWER_MAX);
}

/** エンジン側で必ず通す: 整数に丸めて 0..1000 にクランプ（NaN は 0） */
export function normalizePower(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return clamp(Math.round(v), 0, POWER_MAX);
}

/** 総合戦闘力 = 3ゲームの合計（0〜3000） */
export function totalPower(powers: Iterable<number>): number {
  let sum = 0;
  for (const p of powers) sum += normalizePower(p);
  return sum;
}
