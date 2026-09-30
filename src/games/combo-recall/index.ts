/**
 * コンボ・リコール — 位置 n-back（single n-back。仕様書 6.2）。
 *
 * - 盤面: 3×3 のマス。中央に敵のシルエット、まわりの 8 マスが敵の「攻撃位置」（board.ts）。
 * - 試行: 1 マスが 500 ms 光る → 消灯 2,000 ms。この 2.5 秒の間ずっと「攻撃」を押せる（応答で打ち切らない固定タイミング）。
 *   反応時間は光った瞬間から（エンジンが stimulus フェーズの開始から測る）。
 * - 正解: n 個前と同じ位置（標的）なら押す、それ以外は押さない（expectedResponse = null）。
 * - 系列: 20 + n 試行、標的 6、n ≥ 3 でルアー 10〜15%、同じマスの連続は 2 回まで（nback.ts）。
 * - 適応（ラウンド単位）: 誤り = 見逃し + 誤警報。< 3 で n+1、> 5 で n−1（staircase.ts の nbackStep）。
 * - 1試合 = 1 ラウンド（仕様書 v1.2。3 ラウンド＋「もう1ラウンド」から短縮。追加ラウンドは廃止）。n は 1 試合で最大 ±1。
 * - 戦闘力: K = 9、L = n、acc = 1 − 誤り/(20+n)、accDown = 1 − 5/(20+n)、accUp = 1 − 2/(20+n) の一般式。速さは使わない。
 * - 認定戦: n = ティア、円周上の 8 点の未訓練セット（判定は同じ）。n は変えない。
 */
import { blockPower } from '../../engine/power';
import { NBACK_RULE, nbackStep } from '../../engine/staircase';
import { dPrime, median } from '../../engine/stats';
import type { GameModule, PhaseSpec, Response, ResponseLayout, RoundStats, RoundSummary } from '../../engine/types';
import { comboRecallText as text } from '../../i18n/ja/combo-recall';
import { drawBoard, SURFACE_COUNT } from './board';
import { clampN, generateSequence, N_MAX, trialCount } from './nback';

export type CrParams = { n: number };

export interface CrTrial {
  /** 攻撃位置 0..7（訓練: 3×3 の外周 8 マスを左上から時計回り。認定戦: 円周上の 8 点） */
  pos: number;
  /** 標的: n 個前と同じ位置（押すのが正解） */
  target: boolean;
  /** ルアー: n±1 個前と同じ位置で、n 個前とは違う（押さないのが正解。n ≥ 3 で 10〜15% 入れる） */
  lure: boolean;
  /** 認定戦の未訓練セット（円周上の 8 点）で作った試行 */
  ring: boolean;
}

/** 点灯 500 ms → 消灯 2,000 ms（仕様書 6.2） */
export const LIT_MS = 500;
export const DARK_MS = 2000;
/** 応答ボタンの id */
export const ATTACK = 'attack';
/** 戦闘力の K（n の段数） */
const LEVELS = N_MAX;
/** 誤りがこの数以下なら sub = 1（= 昇格の上限 promoteBelow − 1 = 2） */
const ERR_UP = NBACK_RULE.promoteBelow - 1;
/** 誤りがこの数以上なら sub = 0（= 降格のしきい値 demoteAbove = 5） */
const ERR_DOWN = NBACK_RULE.demoteAbove;
/** 認定戦の1ラウンドの合格ライン（誤り 4 以下。仕様書 第7節） */
export const CERT_MAX_ERRORS = 4;

/** 押したか（応答が「攻撃」） */
function pressed(response: Response | null | undefined): boolean {
  return response?.main === ATTACK;
}

/** 誤り = 見逃し + 誤警報（どの誤答も必ずどちらか） */
function errorCount(stats: RoundStats): number {
  return stats.trials - stats.correct;
}

/** ラウンドの成績を信号検出の4つに分ける（ルアーへの誤警報は別に数える） */
export interface CrTally {
  targets: number;
  lures: number;
  hits: number;
  misses: number;
  /** 誤警報（非標的で押した）。ルアーへの誤警報も含む */
  falseAlarms: number;
  /** そのうちルアーへの誤警報 */
  lureFalseAlarms: number;
  correctRejections: number;
  /** 正しく押した試行（ヒット）の反応時間 */
  hitRts: number[];
}

export function tally(results: RoundSummary<CrParams, CrTrial>['results']): CrTally {
  const t: CrTally = { targets: 0, lures: 0, hits: 0, misses: 0, falseAlarms: 0, lureFalseAlarms: 0, correctRejections: 0, hitRts: [] };
  for (const r of results) {
    const p = pressed(r.response);
    if (r.trial.target) {
      t.targets += 1;
      if (p) {
        t.hits += 1;
        if (r.rtMs !== undefined) t.hitRts.push(r.rtMs);
      } else {
        t.misses += 1;
      }
      continue;
    }
    if (r.trial.lure) t.lures += 1;
    if (p) {
      t.falseAlarms += 1;
      if (r.trial.lure) t.lureFalseAlarms += 1;
    } else {
      t.correctRejections += 1;
    }
  }
  return t;
}

/** 認定戦（円周の未訓練セット）のラウンドか */
function isRingRound(round: RoundSummary<CrParams, CrTrial>): boolean {
  return round.results.length > 0 && round.results.every((r) => r.trial.ring);
}

export const game: GameModule<CrParams, CrTrial> = {
  id: 'combo-recall',
  initialParams: { n: 1 },
  /** 1試合 = 1 ラウンド（仕様書 v1.2）。認定戦は src/cert/ の CERT_ROUNDS（2）で、この値とは別 */
  roundsPerMatch: 1,
  /** 「もう1ラウンド」は廃止（v1.2。1 ラウンドの試合の「一本勝負」表示と矛盾するため）。エンジンの仕組みは残してある */
  extraRounds: 0,
  surfaceCount: SURFACE_COUNT,

  restoreParams(saved) {
    const n = saved.n;
    return { n: typeof n === 'number' ? clampN(n) : 1 };
  },

  createRound(params, rng, opts) {
    const n = clampN(params.n);
    return generateSequence(n, rng).map((it) => ({ pos: it.pos, target: it.target, lure: it.lure, ring: opts.untrained }));
  },

  phases(): PhaseSpec[] {
    // stimulus と response は連続した1つの応答窓。押しても次の刺激の時刻は変わらない（untilResponse を使わない）
    return [
      { name: 'stimulus', ms: LIT_MS, input: true },
      { name: 'response', ms: DARK_MS, input: true },
    ];
  },

  responseLayout(params): ResponseLayout {
    const n = clampN(params.n);
    return {
      columns: 1,
      rows: 1,
      buttons: [{ id: ATTACK, label: text.buttons.attack, ariaLabel: text.attackAria(n), keys: [' ', 'Space'], col: 1, row: 1 }],
    };
  },

  renderStimulus(ctx, trial, phase, _t, view) {
    drawBoard(ctx, view.size, {
      lit: phase === 'stimulus' ? trial.pos : null,
      surface: view.surface,
      untrained: view.untrained,
    });
  },

  judge(trial, response) {
    const p = pressed(response);
    if (trial.target) return p ? { correct: true } : { correct: false, kind: 'miss' };
    return p ? { correct: false, kind: 'fa' } : { correct: true };
  },

  expectedResponse: (trial) => (trial.target ? { main: ATTACK } : null),

  // 例: g3*（訓練の盤・位置 3・標的）、r5~（認定戦の円周・位置 5・ルアー）、g0（標的でもルアーでもない）
  describeTrial: (trial) => `${trial.ring ? 'r' : 'g'}${trial.pos}${trial.target ? '*' : trial.lure ? '~' : ''}`,

  adapt(params, round) {
    const n = clampN(params.n);
    // 認定戦は固定難度（エンジン側でも adaptive = false で呼ばれないが、念のため）
    if (isRingRound(round)) return { n };
    return { n: nbackStep(n, errorCount(round)) };
  },

  power(params, last) {
    const n = clampN(params.n);
    const total = trialCount(n);
    // ラウンドがまだ無いときは sub = 0（到達した n だけ）
    const errors = last ? errorCount(last) : ERR_DOWN;
    return blockPower({ level: n, levels: LEVELS, acc: 1 - errors / total, accDown: 1 - ERR_DOWN / total, accUp: 1 - ERR_UP / total });
  },

  certParams: (tier) => ({ n: clampN(tier) }),

  certRoundPassed: (round) => errorCount(round) <= CERT_MAX_ERRORS,

  enemyLevel: (params) => clampN(params.n),

  metrics(round) {
    const t = tally(round.results);
    const out: Record<string, number> = {
      n: clampN(round.paramsPlayed.n),
      targets: t.targets,
      lures: t.lures,
      hits: t.hits,
      misses: t.misses,
      falseAlarms: t.falseAlarms,
      lureFalseAlarms: t.lureFalseAlarms,
      correctRejections: t.correctRejections,
      errors: t.misses + t.falseAlarms,
      dPrime: Math.round(dPrime(t.hits, t.misses, t.falseAlarms, t.correctRejections) * 100) / 100,
    };
    // 記録用だけ（戦闘力・適応には使わない）
    const rt = median(t.hitRts);
    if (rt !== undefined) out.rtMedianMs = Math.round(rt);
    return out;
  },

  roundTip(round) {
    const t = tally(round.results);
    const errors = t.misses + t.falseAlarms;
    if (errors === 0) return text.tip.perfect;
    if (errors <= ERR_UP) return text.tip.fewErrors;
    if (t.lureFalseAlarms >= 2 && t.lureFalseAlarms * 2 >= t.falseAlarms) return text.tip.lure;
    if (t.misses > t.falseAlarms) return text.tip.moreMisses;
    if (t.falseAlarms > t.misses) return text.tip.moreFalseAlarms;
    return text.tip.balanced;
  },

  roundIntro: (params) => text.intro(clampN(params.n)),
};
