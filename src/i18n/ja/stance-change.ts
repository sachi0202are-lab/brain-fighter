/**
 * スタンスチェンジの文言（仕様書 6.3・第12節）。
 * 主語は「ゲーム内の成績・記録」。ラウンド末の一言は方略や努力に向ける（能力ラベルは使わない）。
 */
import type { GameText } from '../types';

type Rule = 'height' | 'color' | 'shape';
/** 属性の2つの値の呼び名 [左の値, 右の値] */
type Pair = readonly [string, string];

export const stanceChangeText = {
  name: 'スタンスチェンジ',
  tagline: '構えに合わせて判断の基準を切り替えるミニゲーム',
  howTo: [
    '上に出る「構え」で、敵の攻撃アイコンを見る基準が変わります。どの構えでも、答えは左右2つのボタンです。',
    '構えA「高低」: 上段 = 左／下段 = 右。構えB「色」: 橙 = 左／青 = 右。',
    '構えが出てから少しあとにアイコンが出ます。時間内に答えてください（敵レベル 11 からは構えC「形」: 丸 = 左／角 = 右 も加わります）。',
  ],
  keys: 'キー: ← ／ →（F ／ J でも可）',
  /** 決まった傾向が無いラウンドの一言（ラウンド番号で順に使う） */
  tips: [
    '構えの名前を心の中で唱えてから答えると迷いにくい',
    '構えが出ている間に、アイコンのどこを見るかを決めておくと答えやすい',
    '後半も同じ手順で答え続けられた。この調子で続けよう',
  ],
  /** ラウンドの傾向に合わせた一言（metrics.ts の tipKey で選ぶ） */
  tipFor: {
    kept: '構えが切り替わっても正答率をキープできた。この調子で続けよう',
    switch: '構えが変わった直後だけ 0.2 秒待つと安定する',
    repeat: '同じ構えが続くときも、毎回構えを確かめてから答えると安定する',
    timeout: '構えが出ている間に見る基準を決めておくと、時間内に答えやすい',
    conflict: 'もう一方の基準につられたときは、構えの基準だけを見るようにすると安定する',
  },
  buttons: {
    left: '左',
    right: '右',
    /** 読み上げ用: 「左: 上段・橙」 */
    aria: (side: string, label: string): string => `${side}: ${label}`,
    sep: '・',
  },
  stance: {
    /** 画面上部の表示「構えA」 */
    prefix: '構え',
    names: { height: '高低', color: '色', shape: '形' } as Readonly<Record<Rule, string>>,
    /** 未訓練セット（認定戦）の構えの名前 */
    namesUntrained: { height: '大小', color: '色', shape: '形' } as Readonly<Record<Rule, string>>,
  },
  values: { height: ['上段', '下段'], color: ['橙', '青'], shape: ['丸', '角'] } as Readonly<Record<Rule, Pair>>,
  /** 未訓練セット（認定戦）の値の呼び名 */
  valuesUntrained: { height: ['大', '小'], color: ['黄', '紫'], shape: ['三角', '十字'] } as Readonly<Record<Rule, Pair>>,
  intro: {
    /** 構え1つの意味「構えA「高低」上段 = 左／下段 = 右」 */
    rule: (letter: string, name: string, left: string, right: string): string =>
      `構え${letter}「${name}」${left} = 左／${right} = 右`,
    /** 構えと構えの区切り */
    join: '　',
    /** ウォームアップ（単一課題）の説明 */
    warmup: (rule: string, ignored: string): string => `ウォームアップは構えが変わりません。${rule}（${ignored}は気にせず答えます）`,
    /** 「色」「色と形」 */
    and: (names: readonly string[]): string => names.join('と'),
  },
} satisfies GameText & Record<string, unknown>;
