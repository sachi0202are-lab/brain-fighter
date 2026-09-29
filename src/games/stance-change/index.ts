/**
 * スタンスチェンジ — フェーズ1のスタブ（仮実装）。
 *
 * フェーズ2で仕様書 6.3（手がかり付きタスク切替: 30 試行、ステップ 1〜20、D と CSI のラダー、
 * ウォームアップ 12 試行）に置き換える。いまはエンジンの次の経路を通すための最小限の中身:
 *   - 試合冒頭のウォームアップ（createWarmup。適応なし・戦闘力なし）
 *   - 手がかり（cue）→ 刺激＋応答期限（untilResponse）
 *   - ブロック単位のしきい値ルール（≥ 90% 昇格 / 75〜89% 維持 / < 75% 降格）
 *   - 固有指標（反復／切替の RT、切替コスト、混合コスト）
 */
import { blockPower } from '../../engine/power';
import { balancedSequence } from '../../engine/sequence';
import { blockThresholdStep, type BlockRuleConfig } from '../../engine/staircase';
import { median } from '../../engine/stats';
import type { GameModule, PhaseSpec, ResponseLayout } from '../../engine/types';
import { stanceChangeText as text } from '../../i18n/ja/stance-change';
import type { Rng } from '../../engine/rng';

export type ScParams = { step: number };
export type ScRule = 'shape' | 'color';
export interface ScTrial {
  rule: ScRule;
  shape: 'circle' | 'square';
  color: 'orange' | 'blue';
  /** 直前の試行と構えが違う */
  switched: boolean;
}

const TRIALS_PER_ROUND = 6;
const WARMUP_TRIALS = 4;
const MAX_SAME_RULE = 4;
export const STEP_RULE: BlockRuleConfig = { promoteAt: 0.9, demoteBelow: 0.75, min: 1, max: 20 };

const layout: ResponseLayout = {
  columns: 2,
  rows: 1,
  buttons: [
    { id: 'left', label: text.buttons.left, keys: ['ArrowLeft', 'f', 'KeyF'], col: 1, row: 1 },
    { id: 'right', label: text.buttons.right, keys: ['ArrowRight', 'j', 'KeyJ'], col: 2, row: 1 },
  ],
};

const COLORS = { orange: '#ff9f1c', blue: '#2e86ff' } as const;

function makeTrials(rng: Rng, n: number, rules: ScRule[]): ScTrial[] {
  const shapes = balancedSequence(rng, n, ['circle', 'square'] as const, 3);
  const colors = balancedSequence(rng, n, ['orange', 'blue'] as const, 3);
  return rules.map((rule, i) => ({
    rule,
    shape: shapes[i] as ScTrial['shape'],
    color: colors[i] as ScTrial['color'],
    switched: i > 0 && rules[i - 1] !== rule,
  }));
}

function correctSide(t: ScTrial): 'left' | 'right' {
  if (t.rule === 'shape') return t.shape === 'circle' ? 'left' : 'right';
  return t.color === 'orange' ? 'left' : 'right';
}

export const game: GameModule<ScParams, ScTrial> = {
  id: 'stance-change',
  initialParams: { step: 1 },

  createWarmup(_params, rng) {
    return makeTrials(rng, WARMUP_TRIALS, Array<ScRule>(WARMUP_TRIALS).fill('shape'));
  },

  createRound(_params, rng) {
    // 切替率 50%（完全ランダム）、同じ構えの連続は 4 回まで
    const rules: ScRule[] = [rng.pick<ScRule>(['shape', 'color'])];
    const switches = balancedSequence(rng, TRIALS_PER_ROUND - 1, [true, false], 3);
    for (const sw of switches) {
      const prev = rules[rules.length - 1] as ScRule;
      let run = 0;
      for (let k = rules.length - 1; k >= 0 && rules[k] === prev; k--) run++;
      const other: ScRule = prev === 'shape' ? 'color' : 'shape';
      rules.push(sw || run >= MAX_SAME_RULE ? other : prev);
    }
    return makeTrials(rng, TRIALS_PER_ROUND, rules);
  },

  phases(): PhaseSpec[] {
    return [
      { name: 'cue', ms: 400 },
      { name: 'stimulus', ms: 1500, input: true, untilResponse: true },
      { name: 'feedback', ms: 250 },
      { name: 'iti', ms: 300 },
    ];
  },

  responseLayout: () => layout,

  renderStimulus(ctx, trial, phase, _t, view) {
    const s = view.size;
    const c = s / 2;
    if (phase === 'cue' || phase === 'stimulus') {
      ctx.fillStyle = '#f3f5ff';
      ctx.font = `bold ${Math.round(s * 0.07)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(trial.rule === 'shape' ? text.stances.shape : text.stances.color, c, s * 0.14);
    }
    if (phase === 'stimulus') {
      const r = s * 0.12;
      ctx.fillStyle = COLORS[trial.color];
      ctx.beginPath();
      if (trial.shape === 'circle') ctx.arc(c, c + s * 0.05, r, 0, Math.PI * 2);
      else ctx.rect(c - r, c + s * 0.05 - r, r * 2, r * 2);
      ctx.fill();
    }
  },

  judge(trial, response) {
    if (!response) return { correct: false, kind: 'timeout' };
    return response.main === correctSide(trial) ? { correct: true } : { correct: false, kind: trial.switched ? 'switch' : 'repeat' };
  },

  expectedResponse: (trial) => ({ main: correctSide(trial) }),

  describeTrial: (t) => `${t.rule}:${t.shape}/${t.color}${t.switched ? ':sw' : ''}`,

  adapt(params, round) {
    return { step: blockThresholdStep(params.step, round.accuracy, STEP_RULE) };
  },

  power(params, last) {
    return blockPower({ level: params.step, levels: 20, acc: last?.accuracy ?? 0, accDown: 0.75, accUp: 0.9 });
  },

  certParams: (tier) => ({ step: Math.min(20, Math.max(1, tier * 2 - 1)) }),

  enemyLevel: (params) => params.step,

  metrics(round, ctx) {
    const rtOf = (pred: (t: ScTrial) => boolean): number | undefined =>
      median(round.results.filter((r) => r.correct && r.rtMs !== undefined && pred(r.trial)).map((r) => r.rtMs as number));
    const out: Record<string, number> = { step: round.paramsPlayed.step };
    const rep = rtOf((t) => !t.switched);
    const sw = rtOf((t) => t.switched);
    if (rep !== undefined) out.rtRepeat = Math.round(rep);
    if (sw !== undefined) out.rtSwitch = Math.round(sw);
    if (rep !== undefined && sw !== undefined) out.switchCost = Math.round(sw - rep);
    const single = ctx.warmup?.rtMedianMs;
    if (rep !== undefined && single !== undefined) out.mixingCost = Math.round(rep - single);
    return out;
  },

  roundTip: (round) => text.tips[(round.roundNo - 1 + text.tips.length) % text.tips.length] as string,
};
