/**
 * スタンスチェンジの文言。フェーズ2の担当者が自由に編集・追加してよい（GameText の必須キーは残す）。
 * いまはフェーズ1のスタブ（構えに応じて形か色で左右を答える）用の最小限の文言。
 */
import type { GameText } from '../types';

export const stanceChangeText = {
  name: 'スタンスチェンジ',
  tagline: '構えに合わせて判断を切り替えるミニゲーム',
  howTo: ['上に出る「構え」で、判断の基準が変わります。', '構え「形」: まる = 左／しかく = 右。構え「色」: 橙 = 左／青 = 右。'],
  keys: 'キー: ← ／ →（F ／ J でも可）',
  tips: [
    '構えが切り替わった直後は、ひと呼吸おくと安定しやすい',
    '基準を心の中で唱えてから答えると迷いにくい',
    '切り替えのあとも正答率をキープできた',
  ],
  buttons: {
    left: 'ひだり',
    right: 'みぎ',
  },
  stances: {
    shape: '構え: 形',
    color: '構え: 色',
  },
} satisfies GameText & Record<string, unknown>;
