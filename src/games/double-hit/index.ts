/**
 * ダブルヒット（仕様書 6.1。UFOV 型の処理速度・分割注意）。
 *
 * 1試行: 注視点 500 ms → 刺激 T ms（中央の構え＋周辺の火花＋妨害）→ マスク 150 ms
 *        → 応答（構えと火花の方向。順番は自由、5 秒まで）→ フィードバック 300 ms → 試行間隔 500 ms。
 * 両方正解で正答。片方だけ正解は誤答（内訳 kind: stance / dir / both / timeout）。
 * 適応: 試行単位の重み付き階段法（T）＋ラウンド末のステージ昇格（params.ts）。1ラウンド 24 試行、1試合 1 ラウンド（仕様書 v1.2）。
 *
 * 部品: params.ts（難度・適応・戦闘力・認定戦）、trials.ts（試行列・判定）、layout.ts（応答ボタン・キー・タップ）、
 *       render.ts（描画）。
 */
import { median } from '../../engine/stats';
import type { GameModule, PhaseSpec, RoundSummary } from '../../engine/types';
import { doubleHitText as text } from '../../i18n/ja/double-hit';
import { DIR_GROUP, STANCE_GROUP, dirAt, layoutFor } from './layout';
import {
  INITIAL_PARAMS,
  afterRound,
  afterTrial,
  certDhParams,
  clampT,
  dhEnemyLevel,
  dhPower,
  presentedT,
  restoreDhParams,
  type DhParams,
} from './params';
import { renderTrial, SURFACES } from './render';
import { ERROR_KINDS, createTrials, describeTrial, expectedResponse, judgeTrial, type DhTrial } from './trials';

export type { DhParams } from './params';
export type { DhTrial } from './trials';

/** フェーズの長さ (ms)（仕様書 6.1。刺激だけが T で変わる） */
export const PHASE_MS = {
  fixation: 500,
  mask: 150,
  /** 応答の制限時間 */
  response: 5000,
  feedback: 300,
  iti: 500,
} as const;

export function trialPhases(T: number): PhaseSpec[] {
  return [
    { name: 'fixation', ms: PHASE_MS.fixation },
    { name: 'stimulus', ms: clampT(T) },
    { name: 'mask', ms: PHASE_MS.mask },
    { name: 'response', ms: PHASE_MS.response, input: true, untilResponse: true },
    { name: 'feedback', ms: PHASE_MS.feedback },
    { name: 'iti', ms: PHASE_MS.iti },
  ];
}

const r1 = (v: number): number => Math.round(v * 10) / 10;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

/**
 * ラウンドの記録（仕様書 6.1「記録」）。T は実際の提示値（フレームに丸めた値）。
 * - tEnd: ラウンド末の T（次の試行に使う値を丸めたもの）
 * - tMedian: ラウンド内の各試行の提示時間（丸めた値）の中央値
 * - accStance / accDir / accBoth: 構え・火花の方向・両方の正答率（0〜1）
 * - stage: そのラウンドのステージ
 */
export function roundMetrics(round: RoundSummary<DhParams, DhTrial>): Record<string, number> {
  const n = round.results.length;
  const presented = round.results.map((r) => {
    const stim = r.phases.find((p) => p.name === 'stimulus');
    return stim ? stim.plannedMs : presentedT(r.params.T, round.frameMs);
  });
  let stanceOk = 0;
  let dirOk = 0;
  for (const r of round.results) {
    if (r.response?.[STANCE_GROUP] === r.trial.stance) stanceOk += 1;
    if (r.response?.[DIR_GROUP] === r.trial.dir) dirOk += 1;
  }
  const tEnd = presentedT(round.paramsPlayed.T, round.frameMs);
  return {
    tEnd: r1(tEnd),
    tMedian: r1(median(presented) ?? tEnd),
    accStance: n > 0 ? r3(stanceOk / n) : 0,
    accDir: n > 0 ? r3(dirOk / n) : 0,
    accBoth: n > 0 ? r3(round.correct / n) : 0,
    stage: round.paramsPlayed.stage,
  };
}

/**
 * 汎用の一言（tips）の番号 0..count-1。
 * 1試合 = 1 ラウンドなのでラウンド番号だけで順に替えると毎回同じ一言になる。正答数も足して、
 * 試合ごとに違う一言が出やすいようにする（ラウンド番号が 1 つ進めば次の一言、という順番はそのまま）。
 */
export function genericTipIndex(round: Pick<RoundSummary<DhParams, DhTrial>, 'roundNo' | 'correct'>, count: number): number {
  if (count <= 0) return 0;
  const k = Math.max(1, round.roundNo) - 1 + Math.max(0, round.correct);
  return k % count;
}

/** ラウンド末の一言（誤りの内訳から、方略に向けた一言を選ぶ。能力ラベルは使わない） */
export function roundTip(round: RoundSummary<DhParams, DhTrial>): string {
  const e = round.errors;
  const both = e[ERROR_KINDS.both] ?? 0;
  const stanceErr = (e[ERROR_KINDS.stance] ?? 0) + both;
  const dirErr = (e[ERROR_KINDS.dir] ?? 0) + both;
  const timeout = e[ERROR_KINDS.timeout] ?? 0;
  const p = round.paramsPlayed;
  if (timeout >= 2) return text.tipTimeout;
  if (stanceErr >= 2 && stanceErr > dirErr) return p.stances >= 3 ? text.tipStance3 : text.tipStance;
  if (dirErr >= 2 && dirErr > stanceErr) return p.distractors > 0 ? text.tipDirDistractors : text.tipDir;
  if (round.accuracy >= 0.85) return text.tipSteady;
  return text.tips[genericTipIndex(round, text.tips.length)] as string;
}

export const game: GameModule<DhParams, DhTrial> = {
  id: 'double-hit',
  initialParams: INITIAL_PARAMS,
  /** 1 試合 1 ラウンド（仕様書 v1.2） */
  roundsPerMatch: 1,
  surfaceCount: SURFACES.length,

  restoreParams: restoreDhParams,

  createRound: (params, rng) => createTrials(params, rng),

  phases: (_trial, params) => trialPhases(params.T),

  responseLayout: (params) => layoutFor(params.stances),

  renderStimulus(ctx, trial, phase, _t, view) {
    renderTrial(ctx, trial, phase, view);
  },

  hitTest(_trial, phase, x, y, view) {
    return phase === 'response' ? dirAt(x, y, view.size) : null;
  },

  judge: judgeTrial,

  expectedResponse,

  describeTrial,

  adaptTrial: (params, correct) => afterTrial(params, correct),

  adapt: (params, round) => afterRound(params, round.accuracy, round.frameMs),

  power: (params) => dhPower(params),

  certParams: certDhParams,

  enemyLevel: dhEnemyLevel,

  metrics: (round) => roundMetrics(round),

  roundTip,

  roundIntro: (params) => text.intro(params),
};
