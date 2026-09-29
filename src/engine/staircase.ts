/**
 * 階段法（難度の適応）の純粋関数。どれも入力から新しい値を返すだけで、副作用は無い。
 *
 * - (a) weightedStep      乗算型の重み付き階段法（試行単位。例: ダブルヒットの提示時間 T）
 * - (b) blockThresholdStep ブロック単位のしきい値ルール（ラウンド末。例: スタンスチェンジ）
 * - (c) nbackStep          n-back 用「誤り < 3 で +1 / > 5 で −1」（ラウンド末。コンボ・リコール）
 * - (d) upDownStep         N-down/1-up（2-down/1-up は約 70.7% に収束）
 *
 * 仕様書 4.2（MUST）: 難度はアルゴリズムだけが決める。ここ以外で難度を動かさない。
 */

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// ---------------------------------------------------------------------------
// (a) 乗算型の重み付き階段法
// ---------------------------------------------------------------------------

export interface WeightedStaircaseConfig {
  /** 正答時の倍率（例 0.93 = 7% 短く） */
  onCorrect: number;
  /** 誤答時の倍率（例 1.25 = 25% 長く） */
  onError: number;
  /** 内部値の下限・上限 */
  min: number;
  max: number;
  /**
   * 提示値の量子化フック（例: ms をフレーム単位に丸める）。
   * 内部値そのものは量子化しない（量子化すると1フレーム未満の変化が消えて値が張り付くため）。
   */
  quantize?: (value: number) => number;
}

export interface WeightedStaircaseResult {
  /** 次の内部値（連続値、範囲クランプ済み） */
  value: number;
  /** 実際に提示する値（quantize 適用後） */
  presented: number;
}

/** 内部値から提示値を得る */
export function presentedValue(value: number, cfg: WeightedStaircaseConfig): number {
  const v = clamp(value, cfg.min, cfg.max);
  return cfg.quantize ? cfg.quantize(v) : v;
}

/** 1試行ぶん更新する: 正答で ×onCorrect、誤答で ×onError、範囲でクランプ */
export function weightedStep(
  value: number,
  correct: boolean,
  cfg: WeightedStaircaseConfig,
): WeightedStaircaseResult {
  const next = clamp(value * (correct ? cfg.onCorrect : cfg.onError), cfg.min, cfg.max);
  return { value: next, presented: presentedValue(next, cfg) };
}

/**
 * 収束する正答率 p*（対数上の期待変化が 0 になる点）。
 * p·ln(onCorrect) + (1−p)·ln(onError) = 0 → p* = ln(onError) / (ln(onError) − ln(onCorrect))。
 * 0.93 / 1.25 なら約 0.755。
 */
export function equilibriumAccuracy(cfg: Pick<WeightedStaircaseConfig, 'onCorrect' | 'onError'>): number {
  const up = Math.log(cfg.onError);
  const down = Math.log(cfg.onCorrect);
  return up / (up - down);
}

// ---------------------------------------------------------------------------
// (b) ブロック単位のしきい値ルール
// ---------------------------------------------------------------------------

export interface BlockRuleConfig {
  /** この正答率以上で昇格（例 0.90） */
  promoteAt: number;
  /** この正答率未満で降格（例 0.75）。間は維持 */
  demoteBelow: number;
  min: number;
  max: number;
  /** 1回の昇降幅（既定 1） */
  step?: number;
}

export type BlockDecision = 'up' | 'stay' | 'down';

/** 浮動小数の誤差で 27/30 = 0.9 が 0.8999… と判定されないための許容幅 */
const ACC_EPS = 1e-9;

export function blockDecision(accuracy: number, cfg: BlockRuleConfig): BlockDecision {
  if (accuracy + ACC_EPS >= cfg.promoteAt) return 'up';
  if (accuracy + ACC_EPS < cfg.demoteBelow) return 'down';
  return 'stay';
}

/** ラウンド末に呼ぶ: ≥ promoteAt で +step、< demoteBelow で −step、それ以外は維持（範囲クランプ） */
export function blockThresholdStep(level: number, accuracy: number, cfg: BlockRuleConfig): number {
  const step = cfg.step ?? 1;
  const d = blockDecision(accuracy, cfg);
  const next = d === 'up' ? level + step : d === 'down' ? level - step : level;
  return clamp(next, cfg.min, cfg.max);
}

// ---------------------------------------------------------------------------
// (c) n-back 用ルール
// ---------------------------------------------------------------------------

export interface NBackRuleConfig {
  /** 誤りがこれ未満なら n + 1（仕様 3） */
  promoteBelow: number;
  /** 誤りがこれを超えたら n − 1（仕様 5） */
  demoteAbove: number;
  min: number;
  max: number;
}

/** 仕様書 6.2 の値（誤り < 3 で +1、> 5 で −1、n は 1〜9） */
export const NBACK_RULE: NBackRuleConfig = { promoteBelow: 3, demoteAbove: 5, min: 1, max: 9 };

/** errors = 見逃し + 誤警報 */
export function nbackStep(n: number, errors: number, cfg: NBackRuleConfig = NBACK_RULE): number {
  const next = errors < cfg.promoteBelow ? n + 1 : errors > cfg.demoteAbove ? n - 1 : n;
  return clamp(next, cfg.min, cfg.max);
}

// ---------------------------------------------------------------------------
// (d) N-down / 1-up
// ---------------------------------------------------------------------------

export interface UpDownConfig {
  /** 何回連続正答で難しくするか（2-down/1-up なら 2） */
  down: number;
  /** 難しくするときの変化量（符号つき。レベルなら +1、提示時間なら −10 など） */
  harderStep: number;
  /** 易しくするときの変化量（符号つき。レベルなら −1、提示時間なら +10 など） */
  easierStep: number;
  min: number;
  max: number;
}

export interface UpDownState {
  level: number;
  /** 現在の連続正答数（難しくした時点で 0 に戻る） */
  streak: number;
}

export function upDownStep(state: UpDownState, correct: boolean, cfg: UpDownConfig): UpDownState {
  if (!correct) {
    return { level: clamp(state.level + cfg.easierStep, cfg.min, cfg.max), streak: 0 };
  }
  const streak = state.streak + 1;
  if (streak >= cfg.down) {
    return { level: clamp(state.level + cfg.harderStep, cfg.min, cfg.max), streak: 0 };
  }
  return { level: state.level, streak };
}
