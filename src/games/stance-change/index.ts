/**
 * スタンスチェンジ（認知的柔軟性。手がかり付きタスク切替）— 仕様書 6.3。
 *
 * 1試行: 構え（手がかり）を CSI ms → 攻撃アイコン（応答期限 D。答えた時点で次へ）→ 正誤フィードバック 300 ms → 試行間隔 500 ms。
 * アイコンは二価（2 ルール: 高さ・色）または三価（3 ルール: ＋形）の刺激で、応答は左右2ボタン共通
 * （左 = 上段・橙・丸、右 = 下段・青・角）。期限切れは誤答（kind 'timeout'）。
 *
 * 1試合 = 30 試行 × 1 ラウンド（仕様書 v1.1。ユーザーのフィードバックで「ウォームアップ 12 試行＋3 ラウンド」から短縮）。
 * 毎日の試合ではウォームアップ（単一課題）をしないので createWarmup は定義しない。単一課題の試行列（sequence.ts の
 * makeWarmupTrials）と、ウォームアップを渡されたときの混合コスト（metrics.ts）は、測定用に残してある。
 * 難度はステップ 1〜20 のラダー（ladder.ts）をラウンド単位で上下する（≥ 90% で +1、< 75% で −1）。1試合で最大 1 ステップ動く。
 *
 * 部品: model.ts（型）/ ladder.ts（ラダー・適応・認定戦・戦闘力）/ sequence.ts（系列）/ render.ts（描画）/ metrics.ts（記録・一言）
 */
import type { GameModule, Judgement, PhaseSpec, ResponseLayout, RoundKind, RoundOptions } from '../../engine/types';
import { stanceChangeText as text } from '../../i18n/ja/stance-change';
import { certTierParams, clampStep, ladderParams, nextStep, stancePower } from './ladder';
import { genericTipIndex, stanceMetrics, tipKey } from './metrics';
import { activeRules, correctSide, RULE_LETTER, type Rule, type ScParams, type ScTrial, type Side, type Transition } from './model';
import { renderStance, SURFACES } from './render';
import { makeRoundTrials, WARMUP_RULE } from './sequence';

export type { Rule, ScParams, ScTrial, Side, Transition } from './model';

/** 正誤フィードバックの間 (ms)。1 ビットの表示は演出側がこの中で出す（仕様書 4.5: 300 ms 以内） */
export const FEEDBACK_MS = 300;
/** 試行間隔 (ms) */
export const ITI_MS = 500;

/** 左右のボタンの文言（使っている判断軸の値を並べる: 「上段・橙」「上段・橙・丸」） */
export function responseLabels(rules: number, untrained: boolean): Record<Side, string> {
  const values = untrained ? text.valuesUntrained : text.values;
  const dims = activeRules(rules);
  return {
    left: dims.map((d) => values[d][0]).join(text.buttons.sep),
    right: dims.map((d) => values[d][1]).join(text.buttons.sep),
  };
}

export function stanceLayout(params: ScParams, opts: Pick<RoundOptions, 'untrained'>): ResponseLayout {
  const l = responseLabels(params.rules, opts.untrained);
  return {
    columns: 2,
    rows: 1,
    buttons: [
      { id: 'left', label: l.left, ariaLabel: text.buttons.aria(text.buttons.left, l.left), keys: ['ArrowLeft', 'f', 'KeyF'], col: 1, row: 1 },
      { id: 'right', label: l.right, ariaLabel: text.buttons.aria(text.buttons.right, l.right), keys: ['ArrowRight', 'j', 'KeyJ'], col: 2, row: 1 },
    ],
  };
}

/** 試行の記録用の短い文字列（TrialLog.stim） */
const CODES: Readonly<Record<'train' | 'untrained', Readonly<Record<Rule, readonly [string, string]>>>> = {
  train: { height: ['U', 'D'], color: ['o', 'b'], shape: ['r', 'q'] },
  untrained: { height: ['L', 'S'], color: ['y', 'p'], shape: ['t', 'x'] },
};
const TRANSITION_CODE: Readonly<Record<Transition, string>> = { first: 'f', repeat: 'r', switch: 's', single: 'w' };

/**
 * 例 `As:Ub-:i>L` = 構えA・切替 / 上段・青・形なし / 不一致 / 正解は左。
 * 構え A|B|C ＋ 移り変わり f(最初)|r(反復)|s(切替)|w(ウォームアップ) : 高さ U|D（未訓練 L|S）・色 o|b（y|p）・形 r|q（t|x、2 ルールは -）
 * : 一致 c|不一致 i > 正解 L|R
 */
export function describeStance(t: ScTrial): string {
  const c = CODES[t.untrained ? 'untrained' : 'train'];
  const code = (v: Side | null, pair: readonly [string, string]): string => (v === null ? '-' : v === 'left' ? pair[0] : pair[1]);
  const attrs = `${code(t.height, c.height)}${code(t.color, c.color)}${code(t.shape, c.shape)}`;
  return `${RULE_LETTER[t.rule]}${TRANSITION_CODE[t.transition]}:${attrs}:${t.congruent ? 'c' : 'i'}>${correctSide(t) === 'left' ? 'L' : 'R'}`;
}

/** 判定。無応答（期限切れ）は timeout、押し間違いはその試行の移り変わり（switch / repeat / first / single） */
export function judgeStance(trial: ScTrial, response: Readonly<Record<string, string>> | null): Judgement {
  const got = response?.main;
  if (got === undefined) return { correct: false, kind: 'timeout' };
  if (got === correctSide(trial)) return { correct: true };
  return { correct: false, kind: trial.transition };
}

/** ラウンドのルールの一言（構えの意味を出す。kind 'warmup' は単一課題ブロック用で、毎日の試合では使わない） */
export function introText(rules: number, kind: RoundKind, untrained = false): string {
  const names = untrained ? text.stance.namesUntrained : text.stance.names;
  const values = untrained ? text.valuesUntrained : text.values;
  const line = (r: Rule): string => text.intro.rule(RULE_LETTER[r], names[r], values[r][0], values[r][1]);
  if (kind === 'warmup') {
    const ignored = activeRules(rules)
      .filter((r) => r !== WARMUP_RULE)
      .map((r) => names[r]);
    return text.intro.warmup(line(WARMUP_RULE), text.intro.and(ignored));
  }
  return activeRules(rules).map(line).join(text.intro.join);
}

export const game: GameModule<ScParams, ScTrial> = {
  id: 'stance-change',
  initialParams: ladderParams(1),
  /** 1試合 = 1 ラウンド（仕様書 v1.1）。認定戦は src/cert/ の CERT_ROUNDS（2）で、この値とは別 */
  roundsPerMatch: 1,
  surfaceCount: SURFACES.length,

  /** 保存値のステップからラダーの難度を作り直す（D・CSI・ルール数は常にラダーと一致させる） */
  restoreParams: (saved) => ladderParams(saved.step ?? 1),

  createRound: (params, rng, opts) => makeRoundTrials(rng, params.rules, opts.untrained),

  // createWarmup は定義しない（毎日の試合はウォームアップ無し。仕様書 v1.1）

  phases: (_trial, params): PhaseSpec[] => [
    { name: 'cue', ms: params.CSI },
    { name: 'stimulus', ms: params.D, input: true, untilResponse: true },
    { name: 'feedback', ms: FEEDBACK_MS },
    { name: 'iti', ms: ITI_MS },
  ],

  responseLayout: stanceLayout,

  renderStimulus: (ctx, trial, phase, _t, view) => renderStance(ctx, trial, phase, view),

  judge: judgeStance,

  expectedResponse: (trial) => ({ main: correctSide(trial) }),

  describeTrial: describeStance,

  adapt: (params, round) => ladderParams(nextStep(params.step, round.accuracy)),

  power: (params, last) => stancePower(params.step, last),

  certParams: certTierParams,

  enemyLevel: (params) => clampStep(params.step),

  metrics: (round, ctx) => stanceMetrics(round, ctx.warmup),

  roundTip(round) {
    const key = tipKey(round);
    if (key === 'generic') return text.tips[genericTipIndex(round, text.tips.length)] as string;
    return text.tipFor[key];
  },

  /** info.untrained は今のインターフェースには無い（認定戦の画面が渡せるようになれば未訓練セットの呼び名で出す） */
  roundIntro: (params, info: { kind: RoundKind; roundNo: number; untrained?: boolean }) =>
    introText(params.rules, info.kind, info.untrained === true),
};
