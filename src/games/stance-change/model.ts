/**
 * スタンスチェンジの型と定数（仕様書 6.3）。ロジック・描画・文言のどこからでも読む土台。
 */

/**
 * 難度パラメータ（保存形式 Record<string, number> に合わせて数値だけ）。
 * 訓練ではステップからラダー（ladder.ts）で rules / D / CSI を決める。
 * 認定戦ではラダーに無い組合せ（例: 2 ルール・D 1700・CSI 800）もそのまま表せる。
 */
export type ScParams = {
  /** ラダーのステップ 1..20（敵レベル・戦闘力の L）。認定戦では表示用の目安 */
  step: number;
  /** ルール数（2 = 構えA・B、3 = 構えA・B・C） */
  rules: number;
  /** 応答期限 D (ms)。刺激の提示開始から */
  D: number;
  /** 手がかり（構え）から刺激までの間隔 CSI (ms) */
  CSI: number;
};

/** 判断軸（構え）。A = 高低、B = 色、C = 形 */
export type Rule = 'height' | 'color' | 'shape';

/** 応答（左右2ボタン共通） */
export type Side = 'left' | 'right';

/**
 * 直前の試行との関係。
 * first = ラウンド最初の試行（前が無い）、repeat = 同じ構え、switch = 構えが変わった、single = ウォームアップ（単一課題）
 */
export type Transition = 'first' | 'repeat' | 'switch' | 'single';

/**
 * 1試行。属性の値は「その属性で判断したときに正解になる側」で持つ
 * （高さ: left = 上段 / right = 下段、色: left = 橙 / right = 青、形: left = 丸 / right = 角）。
 * 未訓練セット（認定戦）では同じ値を別の見た目で描く（高さ → 大小、色 → 黄／紫、形 → 三角／十字）。
 */
export interface ScTrial {
  /** この試行の構え（判断軸） */
  rule: Rule;
  transition: Transition;
  height: Side;
  color: Side;
  /** 2 ルールのときは null（形は変わらない中立の形で描く） */
  shape: Side | null;
  /** 一致試行 = どの判断軸で答えても同じ応答になる */
  congruent: boolean;
  /** 未訓練の刺激セット（認定戦）で作った試行 */
  untrained: boolean;
}

/** 構えの並び順（A, B, C） */
export const RULE_ORDER: readonly Rule[] = ['height', 'color', 'shape'];

export const RULE_LETTER: Readonly<Record<Rule, string>> = { height: 'A', color: 'B', shape: 'C' };

/** ルール数から、使う判断軸の一覧（2 → A・B、3 → A・B・C） */
export function activeRules(rules: number): Rule[] {
  return rules >= 3 ? ['height', 'color', 'shape'] : ['height', 'color'];
}

export function opposite(side: Side): Side {
  return side === 'left' ? 'right' : 'left';
}

/** 正解の応答 = 構えが示す属性の値 */
export function correctSide(trial: ScTrial): Side {
  const v = trial[trial.rule];
  // 2 ルールで形が構えになることは無い（作らない）が、念のため高さで代用する
  return v ?? trial.height;
}
