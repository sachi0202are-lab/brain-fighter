/**
 * ゲームの登録簿。各ゲームは src/games/<id>/index.ts で `export const game` を公開する。
 * フェーズ2の担当者はこのファイルを編集しない（id と export 名を変えなければ差し替わる）。
 */
import type { GameId } from '../storage/schema';
import { GAME_IDS } from '../storage/schema';
import type { AnyGameModule } from '../engine/types';
import { game as comboRecall } from './combo-recall';
import { game as doubleHit } from './double-hit';
import { game as stanceChange } from './stance-change';

export const GAMES: Readonly<Record<GameId, AnyGameModule>> = {
  'double-hit': doubleHit,
  'combo-recall': comboRecall,
  'stance-change': stanceChange,
};

export { GAME_IDS };

export function getGame(id: string): AnyGameModule | undefined {
  return (GAME_IDS as readonly string[]).includes(id) ? GAMES[id as GameId] : undefined;
}
