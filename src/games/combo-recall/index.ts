/**
 * コンボ・リコール — フェーズ1のスタブ（仮実装）。
 *
 * フェーズ2で仕様書 6.2（位置 n-back: 20 + n 試行、標的 6、ルアー、光る 500 ms → 消灯 2,000 ms）に置き換える。
 * いまはエンジンの次の経路を通すための最小限の中身:
 *   - 応答で打ち切らない固定タイミング（押しても押さなくても次の刺激は同じ時刻）
 *   - 「押さないのが正解」の試行（expectedResponse = null）
 *   - ラウンド単位の n-back ルール（誤り < 3 で +1 / > 5 で −1）と d′
 *   - 「もう1ラウンド」（extraRounds = 1）
 */
import { blockPower } from '../../engine/power';
import { nbackStep } from '../../engine/staircase';
import { dPrime } from '../../engine/stats';
import type { GameModule, PhaseSpec, ResponseLayout, RoundStats } from '../../engine/types';
import { comboRecallText as text } from '../../i18n/ja/combo-recall';

export type CrParams = { n: number };
export interface CrTrial {
  /** 3×3 のマス（0..8） */
  cell: number;
  /** n 個前と同じマス（標的） */
  target: boolean;
}

/** スタブの基本試行数（本番は 20 + n） */
const BASE_TRIALS = 6;
const TARGETS = 2;
const LEVELS = 9;

const layout: ResponseLayout = {
  columns: 1,
  rows: 1,
  buttons: [{ id: 'attack', label: text.buttons.attack, keys: [' ', 'Space'], col: 1, row: 1 }],
};

export const game: GameModule<CrParams, CrTrial> = {
  id: 'combo-recall',
  initialParams: { n: 1 },
  extraRounds: 1,

  createRound(params, rng) {
    const n = Math.max(1, Math.round(params.n));
    const total = BASE_TRIALS + n;
    // 標的の位置（n 以降、隣り合わない）
    const targets = new Set<number>();
    for (const i of rng.shuffle([...Array(total - n).keys()].map((k) => k + n))) {
      if (targets.size >= TARGETS) break;
      if (!targets.has(i - 1) && !targets.has(i + 1)) targets.add(i);
    }
    const cells: number[] = [];
    for (let i = 0; i < total; i++) {
      if (targets.has(i)) {
        cells.push(cells[i - n] as number);
        continue;
      }
      const options = [...Array(9).keys()].filter(
        (c) => (i < n || c !== cells[i - n]) && !(i >= 2 && cells[i - 1] === c && cells[i - 2] === c),
      );
      cells.push(rng.pick(options));
    }
    return cells.map((cell, i) => ({ cell, target: targets.has(i) }));
  },

  phases(): PhaseSpec[] {
    return [
      { name: 'stimulus', ms: 500, input: true },
      { name: 'response', ms: 700, input: true },
      { name: 'feedback', ms: 250 },
      { name: 'iti', ms: 50 },
    ];
  },

  responseLayout: () => layout,

  renderStimulus(ctx, trial, phase, _t, view) {
    const s = view.size;
    const pad = s * 0.12;
    const cell = (s - pad * 2) / 3;
    for (let k = 0; k < 9; k++) {
      const x = pad + (k % 3) * cell;
      const y = pad + Math.floor(k / 3) * cell;
      const lit = phase === 'stimulus' && k === trial.cell;
      ctx.fillStyle = lit ? '#ffd166' : '#232a44';
      ctx.fillRect(x + 4, y + 4, cell - 8, cell - 8);
    }
  },

  judge(trial, response) {
    const pressed = response?.main === 'attack';
    if (trial.target) return pressed ? { correct: true } : { correct: false, kind: 'miss' };
    return pressed ? { correct: false, kind: 'fa' } : { correct: true };
  },

  expectedResponse: (trial) => (trial.target ? { main: 'attack' } : null),

  describeTrial: (trial) => `c${trial.cell}${trial.target ? '*' : ''}`,

  adapt(params, round) {
    return { n: nbackStep(params.n, round.trials - round.correct) };
  },

  power(params, last: RoundStats | null) {
    const total = last?.trials ?? BASE_TRIALS + params.n;
    const errors = last ? last.trials - last.correct : 5;
    return blockPower({
      level: params.n,
      levels: LEVELS,
      acc: 1 - errors / total,
      accDown: 1 - 5 / total,
      accUp: 1 - 2 / total,
    });
  },

  certParams: (tier) => ({ n: Math.min(9, Math.max(1, tier)) }),

  certRoundPassed: (round) => round.trials - round.correct <= 4,

  enemyLevel: (params) => params.n,

  metrics(round) {
    let hits = 0;
    let misses = 0;
    let fas = 0;
    let crs = 0;
    for (const r of round.results) {
      const pressed = r.response?.main === 'attack';
      if (r.trial.target) {
        if (pressed) hits += 1;
        else misses += 1;
      } else if (pressed) fas += 1;
      else crs += 1;
    }
    return { n: round.paramsPlayed.n, hits, misses, falseAlarms: fas, dPrime: Math.round(dPrime(hits, misses, fas, crs) * 100) / 100 };
  },

  roundTip: (round) => text.tips[(round.roundNo - 1 + text.tips.length) % text.tips.length] as string,

  roundIntro: (params) => text.nBack(params.n),
};
