/**
 * 体力ゲージと KO 判定（仕様書 9.3）。すべて試行結果の決定的な関数。
 * 敵 HP（= 勝利に必要な正答数）= ceil(N × p_cpu)、p_cpu = clamp(直近3ラウンドの平均正答率 − 0.05, 0.65, 0.85)。
 * 自分 HP = N − 敵 HP + 1。誤答がこれに達すると「ダウン」演出（ラウンドは最後まで続ける）。
 */
import { clamp } from '../engine/staircase';

export const P_CPU_OFFSET = 0.05;
export const P_CPU_MIN = 0.65;
export const P_CPU_MAX = 0.85;
/** 記録がまだ無いときに仮定する平均正答率（目標 75〜85% の中央） */
export const DEFAULT_RECENT_ACCURACY = 0.8;

export function pCpu(recentAccuracies: readonly number[]): number {
  const last = recentAccuracies.slice(-3);
  const avg = last.length > 0 ? last.reduce((a, b) => a + b, 0) / last.length : DEFAULT_RECENT_ACCURACY;
  return clamp(avg - P_CPU_OFFSET, P_CPU_MIN, P_CPU_MAX);
}

/** 敵 HP（ceil の前に 1e-9 引くのは 0.8−0.05 のような浮動小数の誤差で1多くならないため） */
export function enemyHp(trials: number, recentAccuracies: readonly number[]): number {
  return Math.max(1, Math.ceil(trials * pCpu(recentAccuracies) - 1e-9));
}

export function playerHp(trials: number, enemy: number): number {
  return trials - enemy + 1;
}

export type RoundOutcome = 'perfect' | 'ko' | 'decision';

/** 全問正解で PERFECT、正答数 ≥ 敵 HP で KO、それ以外は判定負け */
export function roundOutcome(trials: number, correct: number, enemy: number): RoundOutcome {
  if (correct >= trials) return 'perfect';
  if (correct >= enemy) return 'ko';
  return 'decision';
}

export interface HpState {
  enemy: number;
  enemyMax: number;
  player: number;
  playerMax: number;
  /** 誤答が自分 HP に達した（ダウン演出。ラウンドは続く） */
  down: boolean;
}

export function hpState(trials: number, enemy: number, correct: number, errors: number): HpState {
  const playerMax = playerHp(trials, enemy);
  return {
    enemy: Math.max(0, enemy - correct),
    enemyMax: enemy,
    player: Math.max(0, playerMax - errors),
    playerMax,
    down: errors >= playerMax,
  };
}
