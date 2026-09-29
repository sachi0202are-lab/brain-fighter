/**
 * 日本語の文言の入口（仕様書 第3節「文言は src/i18n/ja.ts に集約」）。
 * フェーズ2で3人が並行して編集できるように、実体は ja/ の下にファイルを分けている。
 */
import type { GameId } from '../storage/schema';
import type { GameText } from './types';
import { common } from './ja/common';
import { comboRecallText } from './ja/combo-recall';
import { doubleHitText } from './ja/double-hit';
import { stanceChangeText } from './ja/stance-change';

export const ja = {
  ...common,
  games: {
    'double-hit': doubleHitText,
    'combo-recall': comboRecallText,
    'stance-change': stanceChangeText,
  } satisfies Record<GameId, GameText>,
};

export function gameText(id: GameId): GameText {
  return ja.games[id];
}

export function beltName(belt: number): string {
  return ja.belts[Math.max(0, Math.min(ja.belts.length - 1, belt))] as string;
}
