/**
 * ダブルヒットの難度パラメータ・適応・戦闘力・認定戦ティア（仕様書 6.1）。どれも純粋関数。
 *
 * - 難度は T（提示時間）・stage・妨害数・偏心度・構えの種類数の5つの数値。試行列と描画は
 *   stage ではなく「妨害数・偏心度・構えの種類数」だけを見るので、認定戦のようにラダーに無い組合せも表せる。
 * - 訓練ではこの3つを stage から決める（STAGES）。stage は下がらない。
 * - 試行単位: T ← T × 0.93（正答）／ × 1.25（誤答）、33〜500 ms。内部値は連続値のまま持ち、
 *   フレームへの量子化はエンジンが提示のときにだけかける。
 * - ラウンド単位: T（フレームに丸めた提示値）が下限に達していて、ラウンドの正答率 ≥ 80% なら次のステージへ（T は 100 ms に戻す）。
 * - 戦闘力は到達難度（stage と T）だけで決める。反応時間は使わない（仕様書 5.1 MUST）。
 */
import { doubleHitPower } from '../../engine/power';
import { clamp, weightedStep, type WeightedStaircaseConfig } from '../../engine/staircase';
import { quantizeMs } from '../../engine/timing';

/** 難度パラメータ（保存形式 Record<string, number> に合わせて type で定義。値はすべて数値） */
export type DhParams = {
  /** 提示時間 T (ms)。階段法の内部値（連続値）。実際の提示はエンジンがフレーム単位に丸める */
  T: number;
  /** 難度ステージ 0..4（訓練のラダー）。認定戦では妨害数が同じ訓練ステージ（敵レベルの表示用） */
  stage: number;
  /** 妨害刺激の数 */
  distractors: number;
  /** 火花の偏心度（刺激領域の半径に対する %。35 = 半径の 35%） */
  eccPct: number;
  /** 中央の構えの種類数（2 か 3） */
  stances: number;
};

export const T_INITIAL = 300;
export const T_MIN = 33;
export const T_MAX = 500;
/** ステージが上がったときに戻す T */
export const T_AFTER_STAGE_UP = 100;
/** ステージ昇格に必要なラウンドの正答率 */
export const STAGE_UP_ACCURACY = 0.8;
export const MAX_STAGE = 4;

/** 仕様書 6.1 の重み付き階段法（収束正答率 約 75.5%） */
export const T_STAIRCASE: WeightedStaircaseConfig = { onCorrect: 0.93, onError: 1.25, min: T_MIN, max: T_MAX };

export interface StageSpec {
  readonly distractors: number;
  readonly eccPct: number;
  readonly stances: number;
}

/** 難度ステージ（仕様書 6.1）。ステージ4が最上位で、以降は T の伸縮だけ */
export const STAGES: readonly StageSpec[] = [
  { distractors: 0, eccPct: 35, stances: 2 },
  { distractors: 6, eccPct: 35, stances: 2 },
  { distractors: 12, eccPct: 35, stances: 2 },
  { distractors: 24, eccPct: 45, stances: 2 },
  { distractors: 48, eccPct: 45, stances: 3 },
];

export function clampStage(stage: number): number {
  return Number.isFinite(stage) ? clamp(Math.round(stage), 0, MAX_STAGE) : 0;
}

export function clampT(T: number): number {
  return Number.isFinite(T) ? clamp(T, T_MIN, T_MAX) : T_INITIAL;
}

/** 訓練ラダー上の難度（stage から妨害数・偏心度・構えの種類数を決める） */
export function paramsAt(stage: number, T: number): DhParams {
  const s = clampStage(stage);
  const spec = STAGES[s] as StageSpec;
  return { T: clampT(T), stage: s, distractors: spec.distractors, eccPct: spec.eccPct, stances: spec.stances };
}

export const INITIAL_PARAMS: DhParams = paramsAt(0, T_INITIAL);

/**
 * 保存された state から復元する。T と stage だけを信じ、残りはラダーから作り直す
 * （フェーズ1のスタブの保存形式 { T, stage } や、壊れた値からも復元できる）。
 */
export function restoreDhParams(saved: Readonly<Record<string, number>>): DhParams {
  const stage = typeof saved.stage === 'number' ? saved.stage : 0;
  const T = typeof saved.T === 'number' ? saved.T : T_INITIAL;
  return paramsAt(stage, T);
}

/** 試行単位の適応（判定の直後。次の試行から反映） */
export function afterTrial(p: DhParams, correct: boolean): DhParams {
  return { ...p, T: weightedStep(clampT(p.T), correct, T_STAIRCASE).value };
}

/** 実際に提示される T（フレーム単位に丸めた値。エンジンの量子化と同じ計算） */
export function presentedT(T: number, frameMs: number): number {
  return quantizeMs(clampT(T), frameMs).ms;
}

/** T の提示値が下限（33 ms をフレームに丸めた値）に達しているか */
export function atFloor(T: number, frameMs: number): boolean {
  return presentedT(T, frameMs) <= presentedT(T_MIN, frameMs) + 1e-6;
}

/** ステージ昇格の条件: T の提示値が下限、かつラウンドの正答率 ≥ 80%、かつ最上位ステージではない */
export function shouldStageUp(p: DhParams, accuracy: number, frameMs: number): boolean {
  return clampStage(p.stage) < MAX_STAGE && atFloor(p.T, frameMs) && accuracy + 1e-9 >= STAGE_UP_ACCURACY;
}

/** ラウンド単位の適応（ラウンド末）。ステージは下がらない */
export function afterRound(p: DhParams, accuracy: number, frameMs: number): DhParams {
  if (shouldStageUp(p, accuracy, frameMs)) return paramsAt(clampStage(p.stage) + 1, T_AFTER_STAGE_UP);
  return { ...p };
}

// ---------------------------------------------------------------------------
// 認定戦
// ---------------------------------------------------------------------------

export interface CertTier {
  readonly T: number;
  readonly distractors: number;
  readonly eccPct: number;
}

/** 認定戦の固定ティア 1..9（仕様書 6.1: T / 妨害数 / 偏心度） */
export const CERT_TIERS: readonly CertTier[] = [
  { T: 400, distractors: 0, eccPct: 35 },
  { T: 300, distractors: 0, eccPct: 35 },
  { T: 220, distractors: 6, eccPct: 35 },
  { T: 160, distractors: 6, eccPct: 35 },
  { T: 120, distractors: 12, eccPct: 35 },
  { T: 90, distractors: 12, eccPct: 45 },
  { T: 67, distractors: 24, eccPct: 45 },
  { T: 50, distractors: 24, eccPct: 45 },
  { T: 33, distractors: 48, eccPct: 45 },
];

/** 認定戦の構えの種類数（ティアの表は T・妨害数・偏心度だけを決めているので、構えは全ティアで2種） */
export const CERT_STANCES = 2;

/** 妨害数が n 以下の訓練ステージのうち最も上のもの */
export function stageForDistractors(n: number): number {
  let s = 0;
  STAGES.forEach((spec, i) => {
    if (spec.distractors <= n) s = i;
  });
  return s;
}

/** 認定戦のティア（1..9。範囲外は端に寄せる）の固定難度 */
export function certDhParams(tier: number): DhParams {
  const k = Number.isFinite(tier) ? clamp(Math.round(tier), 1, CERT_TIERS.length) : 1;
  const c = CERT_TIERS[k - 1] as CertTier;
  return { T: c.T, stage: stageForDistractors(c.distractors), distractors: c.distractors, eccPct: c.eccPct, stances: CERT_STANCES };
}

// ---------------------------------------------------------------------------
// 戦闘力・敵レベル
// ---------------------------------------------------------------------------

/** 戦闘力 = round(200 × stage + 200 × ln(500 / T) / ln(500 / 33))、0〜1000（engine/power.ts の式） */
export function dhPower(p: DhParams): number {
  return doubleHitPower(clampStage(p.stage), clampT(p.T));
}

/** T の区分 1..10（ln(500/T) を 10 等分。T が短いほど大きい） */
export function tBand(T: number): number {
  const x = Math.log(T_MAX / clampT(T)) / Math.log(T_MAX / T_MIN);
  return 1 + Math.min(9, Math.max(0, Math.floor(x * 10 + 1e-9)));
}

/** 敵レベル = stage × 10 + T の区分（1〜50。stage と T の短さについて単調増加） */
export function dhEnemyLevel(p: DhParams): number {
  return clampStage(p.stage) * 10 + tBand(p.T);
}
