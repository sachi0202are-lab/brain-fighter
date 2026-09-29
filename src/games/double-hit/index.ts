/**
 * ダブルヒット — フェーズ1のスタブ（仮実装）。
 *
 * フェーズ2で仕様書 6.1（UFOV 型: 中央の構え＋周辺の火花＋妨害、24 試行、ステージ 0〜4）に置き換える。
 * いまはエンジンの次の経路を通すための最小限の中身:
 *   - 複合応答（形グループ＋位置グループの両方がそろって判定）
 *   - 試行単位の重み付き階段法（提示時間 T: 正答 ×0.93 / 誤答 ×1.25、33〜500 ms、フレーム量子化はエンジン）
 *   - ラウンド単位のステージ昇格（T が下限かつ正答率 80% 以上）
 *   - 刺激領域のタップ（hitTest）
 */
import { doubleHitPower } from '../../engine/power';
import { mulberry32 } from '../../engine/rng';
import { balancedSequence } from '../../engine/sequence';
import { weightedStep, type WeightedStaircaseConfig } from '../../engine/staircase';
import { median } from '../../engine/stats';
import type { GameModule, PhaseSpec, ResponseLayout } from '../../engine/types';
import { doubleHitText as text } from '../../i18n/ja/double-hit';

export type DhParams = { T: number; stage: number };
export type DhShape = 'circle' | 'square';
export type DhSide = 'left' | 'right';
export interface DhTrial {
  shape: DhShape;
  side: DhSide;
  /** マスク模様の種（描画で乱数を使わないため試行データに入れておく） */
  maskSeed: number;
}

/** スタブの試行数（本番は 24） */
const TRIALS_PER_ROUND = 6;
export const T_STAIRCASE: WeightedStaircaseConfig = { onCorrect: 0.93, onError: 1.25, min: 33, max: 500 };
const CERT_T = [400, 300, 220, 160, 120, 90, 67, 50, 33];
const MAX_STAGE = 4;

const layout: ResponseLayout = {
  columns: 2,
  rows: 2,
  buttons: [
    { id: 'circle', group: 'shape', label: text.buttons.circle, keys: ['q', 'KeyQ'], col: 1, row: 1 },
    { id: 'square', group: 'shape', label: text.buttons.square, keys: ['a', 'KeyA'], col: 2, row: 1 },
    { id: 'left', group: 'side', label: text.buttons.left, keys: ['ArrowLeft'], col: 1, row: 2 },
    { id: 'right', group: 'side', label: text.buttons.right, keys: ['ArrowRight'], col: 2, row: 2 },
  ],
};

const SURFACE_COLORS = ['#f2f4ff', '#ffd166'];
const UNTRAINED_COLOR = '#9ee6ff';

export const game: GameModule<DhParams, DhTrial> = {
  id: 'double-hit',
  initialParams: { T: 300, stage: 0 },
  surfaceCount: 2,

  createRound(_params, rng) {
    const shapes = balancedSequence<DhShape>(rng, TRIALS_PER_ROUND, ['circle', 'square'], 3);
    const sides = balancedSequence<DhSide>(rng, TRIALS_PER_ROUND, ['left', 'right'], 2);
    return shapes.map((shape, i) => ({ shape, side: sides[i] as DhSide, maskSeed: rng.int(0, 2 ** 31) }));
  },

  phases(_trial, params): PhaseSpec[] {
    return [
      { name: 'fixation', ms: 300 },
      { name: 'stimulus', ms: params.T },
      { name: 'mask', ms: 100 },
      { name: 'response', ms: 3000, input: true, untilResponse: true },
      { name: 'feedback', ms: 250 },
      { name: 'iti', ms: 300 },
    ];
  },

  responseLayout: () => layout,

  renderStimulus(ctx, trial, phase, _t, view) {
    const s = view.size;
    const c = s / 2;
    if (phase === 'fixation') {
      ctx.strokeStyle = '#c9cfe8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(c - s * 0.03, c);
      ctx.lineTo(c + s * 0.03, c);
      ctx.moveTo(c, c - s * 0.03);
      ctx.lineTo(c, c + s * 0.03);
      ctx.stroke();
    } else if (phase === 'stimulus') {
      const x = trial.side === 'left' ? c - s * 0.25 : c + s * 0.25;
      const r = s * 0.08;
      ctx.fillStyle = view.untrained ? UNTRAINED_COLOR : (SURFACE_COLORS[view.surface % SURFACE_COLORS.length] as string);
      ctx.beginPath();
      if (trial.shape === 'circle') ctx.arc(x, c, r, 0, Math.PI * 2);
      else ctx.rect(x - r, c - r, r * 2, r * 2);
      ctx.fill();
    } else if (phase === 'mask') {
      const rnd = mulberry32(trial.maskSeed);
      const n = 12;
      const cell = s / n;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const g = Math.floor(40 + rnd.next() * 140);
          ctx.fillStyle = `rgb(${g},${g},${g})`;
          ctx.fillRect(i * cell, j * cell, cell + 0.5, cell + 0.5);
        }
      }
    } else if (phase === 'response') {
      ctx.fillStyle = '#858daa';
      ctx.font = `${Math.round(s * 0.1)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', c, c);
    }
  },

  hitTest(_trial, phase, x, _y, view) {
    if (phase !== 'response') return null;
    return x < view.size / 2 ? 'left' : 'right';
  },

  judge(trial, response) {
    if (!response || response.shape === undefined || response.side === undefined) return { correct: false, kind: 'timeout' };
    const shapeOk = response.shape === trial.shape;
    const sideOk = response.side === trial.side;
    if (shapeOk && sideOk) return { correct: true };
    return { correct: false, kind: !shapeOk && !sideOk ? 'both' : !shapeOk ? 'shape' : 'side' };
  },

  expectedResponse: (trial) => ({ shape: trial.shape, side: trial.side }),

  describeTrial: (trial) => `${trial.shape}/${trial.side}`,

  adaptTrial(params, correct) {
    return { ...params, T: weightedStep(params.T, correct, T_STAIRCASE).value };
  },

  adapt(params, round) {
    if (params.T <= T_STAIRCASE.min + 1e-6 && round.accuracy + 1e-9 >= 0.8 && params.stage < MAX_STAGE) {
      return { stage: params.stage + 1, T: 100 };
    }
    return params;
  },

  power: (params) => doubleHitPower(params.stage, params.T),

  certParams: (tier) => ({ T: CERT_T[Math.min(9, Math.max(1, tier)) - 1] as number, stage: 0 }),

  enemyLevel: (params) => 1 + Math.floor(doubleHitPower(params.stage, params.T) / 100),

  metrics(round) {
    const ts = round.results.map((r) => r.params.T);
    return { tEnd: round.paramsPlayed.T, tMedian: median(ts) ?? round.paramsPlayed.T, stage: round.paramsPlayed.stage };
  },

  roundTip: (round) => text.tips[(round.roundNo - 1 + text.tips.length) % text.tips.length] as string,
};
