/**
 * コンボ・リコールの文言。フェーズ2の担当者が自由に編集・追加してよい（GameText の必須キーは残す）。
 * いまはフェーズ1のスタブ（n 個前と同じマスなら押す）用の最小限の文言。
 */
import type { GameText } from '../types';

export const comboRecallText = {
  name: 'コンボ・リコール',
  tagline: '光ったマスを覚えて照合するミニゲーム',
  howTo: ['マスが1つずつ光ります。', '決められた数だけ前と同じマスが光ったら「攻撃」を押します。違うときは押しません。'],
  keys: 'キー: スペース = 攻撃',
  tips: [
    '光った位置を心の中で言葉にすると照合しやすい',
    '見逃しと押しすぎのバランスを意識して続けよう',
    '後半も集中を切らさずに照合できた',
  ],
  buttons: {
    attack: '攻撃',
  },
  nBack: (n: number): string => `${n} 個前と同じなら攻撃`,
} satisfies GameText & Record<string, unknown>;
