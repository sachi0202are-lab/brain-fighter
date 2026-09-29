/**
 * 演出・記録画面で使う色。
 * ゲームの色は「ゲームという実体」に固定（どの画面・グラフでも同じ）。暗色パネル #171b2e 上で
 * 色覚シミュレーションを含む全ペアの判別性を検証済み（dataviz の validate_palette.js）。
 */
import type { GameId } from '../storage/schema';

export const GAME_COLORS: Readonly<Record<GameId, string>> = {
  'double-hit': '#3987e5',
  'combo-recall': '#d95926',
  'stance-change': '#199e70',
};

/** 総合戦闘力（単一系列）の線。どのゲーム色とも取り違えないよう中立のインク色 */
export const TOTAL_COLOR = '#e7eaf6';

/** ベルトの色（0 白帯 … 9 黒帯二段） */
export const BELT_COLORS: readonly string[] = [
  '#f4f4f4',
  '#f2d23c',
  '#f09a2e',
  '#3fae5a',
  '#3b82f6',
  '#8b5cf6',
  '#8a5a2b',
  '#e23b3b',
  '#141414',
  '#141414',
];
