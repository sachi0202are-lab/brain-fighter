import { describe, expect, it } from 'vitest';
import { fakeGame } from '../test/fake-game';
import { runMatchHeadless, runRoundHeadless } from './headless';
import { concludeRound, runMatch, surfaceIndex } from './match';
import { hashSeed } from './rng';
import type { RoundSummary } from './types';
import type { FakeParams, FakeTrial } from '../test/fake-game';

describe('試合の進行', () => {
  it('3ラウンド。ラウンド単位の適応が次のラウンドに引き継がれる', async () => {
    const game = fakeGame({ trials: 5 });
    const res = await runMatchHeadless(game, { level: 3, stimMs: 100 }, { seed: 1 }, { plan: ({ expected }) => [expected!.side as string] });
    expect(res.warmup).toBeNull();
    expect(res.rounds).toHaveLength(3);
    // 全問正解 → 毎ラウンド level +1
    expect(res.rounds.map((r) => r.summary.paramsStart.level)).toEqual([3, 4, 5]);
    expect(res.paramsEnd.level).toBe(6);
    // 戦闘力は paramsPlayed（そのラウンドを戦った難度）で計算
    expect(res.rounds.map((r) => r.power)).toEqual([350, 450, 550]);
  });

  it('ウォームアップは最初に1回（適応なし・戦闘力は前の値のまま）', async () => {
    const base = fakeGame({ trials: 4 });
    const game = { ...base, createWarmup: base.createRound };
    const seen: string[] = [];
    const res = await runMatchHeadless(game, { level: 2, stimMs: 100 }, { seed: 2, previousPower: 123 }, {
      onRoundDone: (d) => seen.push(`${d.summary.kind}:${d.summary.roundNo}`),
    });
    expect(seen).toEqual(['warmup:0', 'round:1', 'round:2', 'round:3']);
    expect(res.warmup!.power).toBe(123);
    expect(res.warmup!.paramsEnd).toEqual({ level: 2, stimMs: 100 });
    expect(res.warmup!.summary.paramsPlayed.stimMs).toBe(100);
  });

  it('roundsPerMatch = 1 なら 1 ラウンドで終わり、ラウンド間（between）も「もう1ラウンド」の確認も呼ばない', async () => {
    const game = { ...fakeGame({ trials: 4 }), roundsPerMatch: 1 };
    const calls: string[] = [];
    const res = await runMatch(
      { game, params: { level: 3, stimMs: 100 }, surface: 0, previousPower: 0, seedFor: (k, n) => hashSeed(5, game.id, k, n) },
      {
        runRound: (req) =>
          runRoundHeadless(game, req.trials, req.params, req.options, req.adaptive, { plan: ({ expected }) => [expected!.side as string] }),
        onRoundDone: (d) => void calls.push(`done:${d.summary.kind}:${d.summary.roundNo}`),
        between: async () => void calls.push('between'),
        askExtra: async () => {
          calls.push('askExtra');
          return true;
        },
      },
    );
    expect(res.warmup).toBeNull();
    expect(res.rounds).toHaveLength(1);
    expect(calls).toEqual(['done:round:1']);
    // ラウンド単位の適応と戦闘力は 1 ラウンドでも行う（全問正解 → level +1、次の試合はその難度から）
    expect(res.rounds[0]!.summary.paramsPlayed.level).toBe(3);
    expect(res.paramsEnd.level).toBe(4);
    expect(res.rounds[0]!.power).toBe(350);
  });

  it('extraRounds があれば「もう1ラウンド」で1本増える', async () => {
    const game = { ...fakeGame({ trials: 3 }), extraRounds: 1 };
    const yes = await runMatchHeadless(game, game.initialParams, { seed: 3 }, { extra: true });
    expect(yes.rounds).toHaveLength(4);
    const no = await runMatchHeadless(game, game.initialParams, { seed: 3 }, { extra: false });
    expect(no.rounds).toHaveLength(3);
  });

  it('認定戦のように adaptive=false なら難度は動かない', async () => {
    const game = fakeGame({ trials: 4 });
    const res = await runMatchHeadless(game, { level: 5, stimMs: 80 }, { seed: 4, adaptive: false, rounds: 2, untrained: true });
    expect(res.rounds).toHaveLength(2);
    for (const r of res.rounds) {
      expect(r.summary.paramsPlayed).toEqual({ level: 5, stimMs: 80 });
      expect(r.paramsEnd).toEqual({ level: 5, stimMs: 80 });
    }
  });

  it('同じシードなら同じ試行列', async () => {
    const game = fakeGame({ trials: 6 });
    const a = await runMatchHeadless(game, game.initialParams, { seed: 9 });
    const b = await runMatchHeadless(game, game.initialParams, { seed: 9 });
    const c = await runMatchHeadless(game, game.initialParams, { seed: 10 });
    const stims = (m: typeof a): string => m.rounds.map((r) => r.summary.results.map((x) => x.stim).join('')).join('|');
    expect(stims(a)).toBe(stims(b));
    expect(stims(a)).not.toBe(stims(c));
  });
});

describe('concludeRound', () => {
  it('戦闘力は 0..1000 の整数に丸める。power には RT を含まない成績だけ渡る', () => {
    const game = { ...fakeGame(), power: (_p: FakeParams, last: unknown) => (Object.keys(last as object).includes('results') ? -1 : 1234.4) };
    const summary = {
      kind: 'round',
      roundNo: 1,
      trials: 10,
      correct: 8,
      accuracy: 0.8,
      errors: { wrong: 2 },
      paramsStart: { level: 1, stimMs: 100 },
      paramsPlayed: { level: 1, stimMs: 90 },
      maxCombo: 5,
      frameMs: 1000 / 60,
      results: [],
      rtMedianMs: 400,
    } as RoundSummary<FakeParams, FakeTrial>;
    const d = concludeRound(game, summary, { adaptive: true, warmup: null, previousPower: 0, seed: 1 });
    expect(d.power).toBe(1000);
  });
});

describe('表層バリエーション（仕様書 4.4）', () => {
  it('最初の2試合は固定、以降2試合ごとに入れ替え', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((m) => surfaceIndex(m, 3))).toEqual([0, 0, 1, 1, 2, 2, 0]);
    expect([0, 1, 2, 3].map((m) => surfaceIndex(m, 1))).toEqual([0, 0, 0, 0]);
  });
});
