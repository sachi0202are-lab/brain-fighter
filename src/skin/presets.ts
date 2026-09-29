/**
 * 演出プリセット（仕様書 9.1）。
 * どのプリセットでも試行数・提示時間・刺激間隔・応答期限・標的比率は同じ（MUST）。
 * ここは「何を見せるか」だけを決め、ラウンド実行には一切関わらない。
 */
import type { FxPreset } from '../storage/schema';

export interface SkinFeatures {
  /** 上帯の HP バー（静的） */
  hpBars: boolean;
  /** 短い正誤音 */
  sound: boolean;
  /** ラウンド末の KO / PERFECT / 判定表示 */
  outcomeLogo: boolean;
  /** ラウンド間のシルエットのファイター */
  fighters: boolean;
  /** 上帯のコンボ表示 */
  combo: boolean;
  /** ラウンド間の技名テロップ（必殺演出） */
  special: boolean;
  /** 静的なカスタム背景（刺激領域の外） */
  background: boolean;
}

export const SKIN_FEATURES: Readonly<Record<FxPreset, SkinFeatures>> = {
  off: { hpBars: false, sound: false, outcomeLogo: false, fighters: false, combo: false, special: false, background: false },
  light: { hpBars: true, sound: true, outcomeLogo: true, fighters: true, combo: false, special: false, background: false },
  full: { hpBars: true, sound: true, outcomeLogo: true, fighters: true, combo: true, special: true, background: true },
};

/** 1 ビットフィードバックの表示時間の上限 (ms)。仕様書 4.5「300ms 以内」 */
export const FEEDBACK_MS = 250;
