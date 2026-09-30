/**
 * ダブルヒットの文言（仕様書 6.1）。文言ルールは仕様書 第12節（`npm run lint:words`）。
 * 主語は「ゲーム内の成績・記録」。一言（tips）は方略や努力に向け、能力への称賛・能力ラベルは使わない。
 */
import type { GameText } from '../types';

type StanceKey = 'high' | 'low' | 'mid';
type DirKey = 'd7' | 'd8' | 'd9' | 'd4' | 'd6' | 'd1' | 'd2' | 'd3';

export const doubleHitText = {
  name: 'ダブルヒット',
  tagline: '中央の構えと、周りに一瞬出る火花の方向を同時に見切るミニゲーム',
  howTo: [
    '中央に敵の構え、周りの8方向のどこかに火花が一瞬だけ出て、すぐに砂嵐で隠れます。',
    '構え（下のボタン）と火花の方向（矢印のボタンか、枠の中の丸をタップ）を両方答えます。順番は自由、制限は5秒です。',
    '両方そろって正解。見える時間は正誤に合わせて自動で短く／長くなります。',
  ],
  keys: 'キー: 構え = Q 上段 ／ A 下段 ／ Z 中段（3種類のときだけ）。火花の方向 = テンキー 7 8 9 / 4 6 / 1 2 3（U I O / J L / M , . や矢印キーでも可）',
  /** ラウンド末の一言（どれにも当てはまらないとき、正答数とラウンド番号で順に出す。index.ts の genericTipIndex） */
  tips: [
    '注視点が出たら中央に目を置き、まばたきは答えた後にすませておくと安定しやすい',
    '中央を見たまま、画面全体をぼんやり広く見るつもりで待つと答えやすい',
    '迷ったら最初の印象で答えると安定しやすい',
  ],
  /** 誤りの内訳に合わせた一言 */
  tipStance: '構えは拳の高さ（頭より上か、腰の横か）だけに絞って見ると区別しやすい',
  tipStance3: '構えは拳の高さ（頭の上・肩の横・腰の横）だけに絞って見ると区別しやすい',
  tipDir: '目は中央に置いたまま、周り全体をぼんやり広く見ると火花の方向を拾いやすい',
  tipDirDistractors: '暗い図形は気にせず、いちばん明るい点だけを探すつもりで見ると方向を拾いやすい',
  tipTimeout: '5 秒以内なら順番は自由。覚えている方から先に押すと答えやすい',
  tipSteady: '最後まで正答率をキープできた。この調子で続けよう',
  /** 構えのボタン */
  stances: { high: '上段', low: '下段', mid: '中段' } satisfies Record<StanceKey, string>,
  stanceAria: (name: string): string => `構え ${name}`,
  /** 火花の方向のボタン（表示は矢印、読み上げは方向の名前） */
  dirLabels: { d7: '↖', d8: '↑', d9: '↗', d4: '←', d6: '→', d1: '↙', d2: '↓', d3: '↘' } satisfies Record<DirKey, string>,
  dirNames: { d7: '左上', d8: '上', d9: '右上', d4: '左', d6: '右', d1: '左下', d2: '下', d3: '右下' } satisfies Record<DirKey, string>,
  dirAria: (name: string): string => `火花の方向 ${name}`,
  /** 次のラウンドのルールの一言（開始前とラウンド間に出る） */
  intro: (p: { distractors: number; eccPct: number; stances: number }): string => {
    const outer = p.eccPct >= 45 ? '（火花は少し外側に出る）' : '';
    if (p.stances >= 3) {
      return `構えは上段・中段・下段の3種類。暗い図形 ${p.distractors} 個にまぎれた火花の方向と同時に見切れ${outer}`;
    }
    if (p.distractors > 0) {
      return `暗い図形 ${p.distractors} 個にまぎれた火花の方向と、中央の構えを同時に見切れ${outer}`;
    }
    return `中央の構えと、周りに出る火花の方向を同時に見切れ${outer}`;
  },
} satisfies GameText & Record<string, unknown>;
