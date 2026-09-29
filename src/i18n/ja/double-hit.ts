/**
 * ダブルヒットの文言。フェーズ2の担当者が自由に編集・追加してよい（GameText の必須キーは残す）。
 * いまはフェーズ1のスタブ（形と左右の2つを答える）用の最小限の文言。
 */
import type { GameText } from '../types';

export const doubleHitText = {
  name: 'ダブルヒット',
  tagline: '中央と周辺を同時に見分けるミニゲーム',
  howTo: ['一瞬だけ出る図形の「形」と「左右どちらに出たか」を、両方答えます。', '両方そろって正解です。'],
  keys: 'キー: 形 = Q（まる）／ A（しかく）、位置 = ← ／ →',
  tips: [
    '画面の中央を見たまま、周りを広く見ると答えやすい',
    '後半も正答率をキープできた。この調子で続けよう',
    '迷ったら最初の印象で答えると安定しやすい',
  ],
  buttons: {
    circle: 'まる',
    square: 'しかく',
    left: 'ひだり',
    right: 'みぎ',
  },
} satisfies GameText & Record<string, unknown>;
