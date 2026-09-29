/**
 * エンジンのテスト用の小さなゲーム（本物のゲームとは無関係）。
 * 刺激 = 'L' か 'R'。応答グループは 'side'（必須）と、複合応答のテスト用に任意で 'color'。
 */
import type { GameModule, PhaseSpec, Response, ResponseLayout } from '../engine/types';

export type FakeParams = { level: number; stimMs: number };
export interface FakeTrial {
  side: 'L' | 'R';
  color: 'red' | 'blue';
}

export interface FakeOptions {
  trials?: number;
  compound?: boolean;
  /** 応答フェーズの期限 */
  deadlineMs?: number;
  /** 応答で打ち切らない固定タイミング */
  fixedTiming?: boolean;
}

export function fakeGame(opts: FakeOptions = {}): GameModule<FakeParams, FakeTrial> {
  const n = opts.trials ?? 8;
  const layout: ResponseLayout = {
    columns: 2,
    rows: opts.compound ? 2 : 1,
    buttons: [
      { id: 'L', group: 'side', label: 'L', keys: ['ArrowLeft'], col: 1, row: 1 },
      { id: 'R', group: 'side', label: 'R', keys: ['ArrowRight'], col: 2, row: 1 },
      ...(opts.compound
        ? [
            { id: 'red', group: 'color', label: 'red', keys: ['q'], col: 1, row: 2 },
            { id: 'blue', group: 'color', label: 'blue', keys: ['a'], col: 2, row: 2 },
          ]
        : []),
    ],
  };
  return {
    id: 'double-hit',
    initialParams: { level: 1, stimMs: 100 },
    createRound(_p, rng) {
      return Array.from({ length: n }, () => ({
        side: rng.chance(0.5) ? 'L' : 'R',
        color: rng.chance(0.5) ? 'red' : 'blue',
      }));
    },
    phases(_t, p): PhaseSpec[] {
      return opts.fixedTiming
        ? [
            { name: 'stimulus', ms: 500, input: true },
            { name: 'response', ms: 1000, input: true },
            { name: 'iti', ms: 0 },
          ]
        : [
            { name: 'fixation', ms: 200 },
            { name: 'stimulus', ms: p.stimMs },
            { name: 'response', ms: opts.deadlineMs ?? 1000, input: true, untilResponse: true },
            { name: 'feedback', ms: 250 },
            { name: 'iti', ms: 300 },
          ];
    },
    responseLayout: () => layout,
    renderStimulus(ctx, trial, phase) {
      if (phase === 'stimulus') ctx.fillText(trial.side, 0, 0);
    },
    judge(trial, r) {
      if (!r || r.side === undefined || (opts.compound && r.color === undefined)) return { correct: false, kind: 'timeout' };
      const ok = r.side === trial.side && (!opts.compound || r.color === trial.color);
      return ok ? { correct: true } : { correct: false, kind: 'wrong' };
    },
    expectedResponse: (t): Response => (opts.compound ? { side: t.side, color: t.color } : { side: t.side }),
    describeTrial: (t) => `${t.side}${opts.compound ? `/${t.color}` : ''}`,
    adaptTrial: (p, correct) => ({ ...p, stimMs: Math.max(17, Math.min(500, p.stimMs * (correct ? 0.9 : 1.2))) }),
    adapt: (p, round) => ({ ...p, level: round.accuracy >= 0.9 ? p.level + 1 : round.accuracy < 0.75 ? Math.max(1, p.level - 1) : p.level }),
    power: (p, last) => Math.round(100 * p.level + 50 * (last?.accuracy ?? 0)),
    certParams: (tier) => ({ level: tier, stimMs: 100 }),
    enemyLevel: (p) => p.level,
  };
}
