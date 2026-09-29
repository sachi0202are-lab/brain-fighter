/**
 * ゲームごとの文言ファイル（src/i18n/ja/<game-id>.ts）が満たす形。
 * 必須キー以外は各ゲームが自由に足してよい（ゲームのコードは自分の文言ファイルを直接 import する）。
 *
 * 文言ルール（仕様書 第12節）: 主語は「ゲーム内の成績・記録」。能力ラベルや効果をうたう語は使わない。
 * `npm run lint:words` で禁止語をチェックする。
 */
export interface GameText {
  /** ゲーム名 */
  name: string;
  /** ホームのカードに出す短い説明（1行） */
  tagline: string;
  /** 試合開始前の遊び方（1〜3行） */
  howTo: readonly string[];
  /** PC のキー操作の説明（1行） */
  keys: string;
  /** ラウンド末の一言の候補（方略・努力に向けた文。能力への称賛は使わない） */
  tips: readonly string[];
}
