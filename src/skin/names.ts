/**
 * 敵キャラの名前（無意味語。実在のキャラ名は使わない）と技名テロップ。
 * 敵 = 難度の擬人化なので、ゲームと敵レベルから決定的に決める。
 */
import type { GameId } from '../storage/schema';

const HEAD = ['ガ', 'ズ', 'ド', 'バ', 'ギ', 'ボ', 'ザ', 'ゾ', 'ダ', 'グ', 'ヴァ', 'ジ'];
const MID = ['ル', 'ム', 'ラ', 'ロ', 'ネ', 'ミ', 'レ', 'ナ', 'ヌ', 'モ'];
const TAIL = ['ド', 'ガ', 'ン', 'ゴ', 'ブ', 'ズ', 'ク', 'ダ', 'ヴ', 'ト'];
const GAME_OFFSET: Record<GameId, number> = { 'double-hit': 0, 'combo-recall': 4, 'stance-change': 8 };

export function enemyName(gameId: GameId, level: number): string {
  const k = Math.max(0, Math.round(level)) + GAME_OFFSET[gameId];
  return `${HEAD[k % HEAD.length]}${MID[(k * 7 + 3) % MID.length]}${TAIL[(k * 5 + 1) % TAIL.length]}`;
}

const MOVE_A = ['蒼', '紅', '迅', '轟', '閃', '嵐', '雷', '烈'];
const MOVE_B = ['連撃', '双撃', '旋風', '一閃', '落雷', '疾風'];

/** 技名テロップ（Full の必殺演出。ラウンド間だけ） */
export function specialMoveName(seed: number): string {
  const k = Math.abs(Math.round(seed));
  return `${MOVE_A[k % MOVE_A.length]}の${MOVE_B[(k * 3 + 1) % MOVE_B.length]}`;
}
