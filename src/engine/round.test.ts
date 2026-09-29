import { describe, expect, it } from 'vitest';
import { fakeGame } from '../test/fake-game';
import { mockContext2D } from '../test/mock-canvas';
import { runRoundHeadless } from './headless';
import { mulberry32 } from './rng';
import { RoundAborted, RoundRunner, type RoundEvent } from './round';
import { quantizeMs, VirtualScheduler } from './timing';
import type { RoundOptions } from './types';

const F = 1000 / 60;
const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };

describe('RoundRunner（仮想時計）', () => {
  it('全試行を提示して判定し、集計する', async () => {
    const game = fakeGame({ trials: 10 });
    const trials = game.createRound(game.initialParams, mulberry32(1), OPTS);
    const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, true, {
      plan: ({ i, expected }) => (i % 5 === 4 ? [expected!.side === 'L' ? 'R' : 'L'] : [expected!.side as string]),
    });
    expect(s.trials).toBe(10);
    expect(s.results).toHaveLength(10);
    expect(s.correct).toBe(8);
    expect(s.accuracy).toBeCloseTo(0.8, 10);
    expect(s.errors).toEqual({ wrong: 2 });
    expect(s.maxCombo).toBe(4);
    expect(s.kind).toBe('round');
    expect(s.frameMs).toBeCloseTo(F, 10);
  });

  it('フェーズはフレームに量子化され、仮想時計では実測 = 予定', async () => {
    const game = fakeGame({ trials: 3 });
    const trials = game.createRound(game.initialParams, mulberry32(2), OPTS);
    const s = await runRoundHeadless(game, trials, { level: 1, stimMs: 33 }, OPTS, false, { delayMs: 300 });
    for (const r of s.results) {
      const stim = r.phases.find((p) => p.name === 'stimulus')!;
      expect(stim.frames).toBe(2);
      expect(stim.plannedMs).toBeCloseTo(2 * F, 9);
      expect(stim.endMs - stim.startMs).toBeCloseTo(stim.plannedMs, 6);
      const fix = r.phases.find((p) => p.name === 'fixation')!;
      expect(fix.endMs - fix.startMs).toBeCloseTo(quantizeMs(200, F).ms, 6);
      // 0 ms のフェーズは無い
      expect(r.phases.every((p) => p.frames > 0)).toBe(true);
    }
  });

  it('応答期限つきフェーズは応答で打ち切られ、反応時間は刺激の開始から測る', async () => {
    const game = fakeGame({ trials: 4 });
    const trials = game.createRound(game.initialParams, mulberry32(3), OPTS);
    const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, { delayMs: 300 });
    for (const r of s.results) {
      const resp = r.phases.find((p) => p.name === 'response')!;
      const stim = r.phases.find((p) => p.name === 'stimulus')!;
      expect(resp.plannedMs).toBeCloseTo(1000, 6); // 予定（期限）はそのまま記録
      expect(resp.endMs - resp.startMs).toBeLessThan(400); // 実際は応答で終わる
      // RT = 刺激 (100ms = 6 フレーム) + 応答画面が開いてから押すまで（300ms を超える最初のフレーム）
      expect(r.rtMs).toBeGreaterThanOrEqual(stim.plannedMs + 300 - 1e-6);
      expect(r.rtMs).toBeLessThan(stim.plannedMs + 300 + F + 1e-6);
      expect(r.onsetMs).toBeCloseTo(stim.startMs, 9);
    }
  });

  it('期限までに応答しなければ期限で判定（kind = timeout）', async () => {
    const game = fakeGame({ trials: 2, deadlineMs: 500 });
    const trials = game.createRound(game.initialParams, mulberry32(4), OPTS);
    const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, { plan: () => [] });
    expect(s.correct).toBe(0);
    expect(s.errors).toEqual({ timeout: 2 });
    for (const r of s.results) {
      const resp = r.phases.find((p) => p.name === 'response')!;
      expect(resp.endMs - resp.startMs).toBeCloseTo(quantizeMs(500, F).ms, 6);
      expect(r.rtMs).toBeUndefined();
      expect(r.response).toBeNull();
    }
  });

  it('複合応答は全グループがそろって完成。そろう前は同じグループで選び直せる', async () => {
    const game = fakeGame({ trials: 3, compound: true });
    const trials = game.createRound(game.initialParams, mulberry32(5), OPTS);
    const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, {
      plan: ({ expected }) => {
        const wrongSide = expected!.side === 'L' ? 'R' : 'L';
        return [wrongSide, expected!.side as string, expected!.color as string];
      },
    });
    expect(s.correct).toBe(3);
    for (const r of s.results) expect(r.response).toEqual({ side: r.trial.side, color: r.trial.color });
  });

  it('片方のグループだけでは完成せず、期限で未完成のまま判定', async () => {
    const game = fakeGame({ trials: 2, compound: true, deadlineMs: 400 });
    const trials = game.createRound(game.initialParams, mulberry32(6), OPTS);
    const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, {
      plan: ({ expected }) => [expected!.side as string],
    });
    expect(s.correct).toBe(0);
    for (const r of s.results) {
      expect(r.response).toEqual({ side: r.trial.side });
      expect(r.rtMs).toBeUndefined();
    }
  });

  it('応答窓の外の入力・未知の id は無視する', () => {
    const game = fakeGame({ trials: 2 });
    const sched = new VirtualScheduler(F, 0);
    const trials = game.createRound(game.initialParams, mulberry32(7), OPTS);
    const runner = new RoundRunner({ game, trials, params: game.initialParams, options: OPTS, adaptive: false, scheduler: sched });
    runner.start().catch(() => {});
    expect(runner.input('L')).toBe(false); // まだ始まっていない
    sched.step(); // fixation
    expect(runner.snapshot()!.phase).toBe('fixation');
    expect(runner.input('L')).toBe(false);
    for (let k = 0; k < 30 && runner.snapshot()!.phase !== 'response'; k++) sched.step();
    expect(runner.snapshot()!.accepting).toBe(true);
    expect(runner.input('nope')).toBe(false);
    expect(runner.input('L')).toBe(true);
    expect(runner.input('R')).toBe(false); // 完成後は受け付けない
    runner.abort();
  });

  it('試行単位の適応は次の試行から反映、adaptive=false なら変わらない', async () => {
    const game = fakeGame({ trials: 4 });
    const trials = game.createRound(game.initialParams, mulberry32(8), OPTS);
    const allCorrect = await runRoundHeadless(game, trials, { level: 1, stimMs: 100 }, OPTS, true, { plan: ({ expected }) => [expected!.side as string] });
    const planned = allCorrect.results.map((r) => r.phases.find((p) => p.name === 'stimulus')!.plannedMs);
    expect(planned[0]).toBeCloseTo(quantizeMs(100, F).ms, 9);
    expect(planned[1]).toBeCloseTo(quantizeMs(90, F).ms, 9);
    expect(allCorrect.results.map((r) => r.params.stimMs)).toEqual([100, 90, 81, 72.9].map((v) => expect.closeTo(v, 9)));
    expect(allCorrect.paramsPlayed.stimMs).toBeCloseTo(65.61, 9);
    expect(allCorrect.paramsStart.stimMs).toBe(100);
    const fixed = await runRoundHeadless(game, trials, { level: 1, stimMs: 100 }, OPTS, false, { plan: ({ expected }) => [expected!.side as string] });
    expect(fixed.paramsPlayed.stimMs).toBe(100);
  });

  it('応答で打ち切らない固定タイミング: 押しても押さなくても刺激の間隔は同じ', async () => {
    const game = fakeGame({ trials: 6, fixedTiming: true });
    const trials = game.createRound(game.initialParams, mulberry32(9), OPTS);
    const pressed = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, { delayMs: 100 });
    const silent = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, { plan: () => [] });
    const onsets = (s: typeof pressed): number[] => s.results.map((r) => r.onsetMs);
    expect(onsets(pressed)).toEqual(onsets(silent));
    for (let i = 1; i < pressed.results.length; i++) {
      expect(pressed.results[i]!.onsetMs - pressed.results[i - 1]!.onsetMs).toBeCloseTo(1500, 6);
    }
  });

  it('judged イベントの feedbackMaxMs は次の刺激までの残り時間', async () => {
    const game = fakeGame({ trials: 3 });
    const trials = game.createRound(game.initialParams, mulberry32(10), OPTS);
    const judged: Extract<RoundEvent, { type: 'judged' }>[] = [];
    await runRoundHeadless(game, trials, game.initialParams, OPTS, false, {
      onEvent: (e) => {
        if (e.type === 'judged') judged.push(e);
      },
    });
    expect(judged).toHaveLength(3);
    for (const e of judged) expect(e.feedbackMaxMs).toBeCloseTo(quantizeMs(250, F).ms + quantizeMs(300, F).ms, 6);
  });

  it('購読側が例外を投げても進行は止まらない', async () => {
    const game = fakeGame({ trials: 3 });
    const trials = game.createRound(game.initialParams, mulberry32(11), OPTS);
    const errSpy = console.error;
    console.error = () => {};
    try {
      const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, false, {
        onEvent: () => {
          throw new Error('skin bug');
        },
      });
      expect(s.trials).toBe(3);
    } finally {
      console.error = errSpy;
    }
  });

  it('renderStimulus は毎フレーム呼ばれる（描画先がある場合）', async () => {
    const game = fakeGame({ trials: 2 });
    const trials = game.createRound(game.initialParams, mulberry32(12), OPTS);
    const { ctx, calls } = mockContext2D();
    let begins = 0;
    await runRoundHeadless(game, trials, game.initialParams, OPTS, false, {
      surface: {
        begin: () => {
          begins++;
          return { ctx, size: 300 };
        },
      },
    });
    expect(begins).toBeGreaterThan(20);
    expect(calls.get('fillText')).toBeGreaterThan(0);
  });

  it('abort すると RoundAborted で失敗する', async () => {
    const game = fakeGame({ trials: 2 });
    const sched = new VirtualScheduler(F, 0);
    const trials = game.createRound(game.initialParams, mulberry32(13), OPTS);
    const runner = new RoundRunner({ game, trials, params: game.initialParams, options: OPTS, adaptive: false, scheduler: sched });
    const p = runner.start();
    sched.step();
    runner.abort();
    await expect(p).rejects.toBeInstanceOf(RoundAborted);
    expect(runner.done).toBe(true);
    expect(sched.pending).toBe(0);
  });

  it('フェーズ名の重複と試行 0 件はエラー（ゲーム側の例外はラウンドの失敗になり、止まったままにならない）', async () => {
    const game = fakeGame({ trials: 1 });
    const sched = new VirtualScheduler(F, 0);
    expect(() => new RoundRunner({ game, trials: [], params: game.initialParams, options: OPTS, adaptive: false, scheduler: sched })).toThrow();
    const dup = { ...game, phases: () => [{ name: 'stimulus' as const, ms: 100 }, { name: 'stimulus' as const, ms: 100 }] };
    const runner = new RoundRunner({ game: dup, trials: [{ side: 'L', color: 'red' }], params: game.initialParams, options: OPTS, adaptive: false, scheduler: sched });
    const p = runner.start();
    sched.step();
    await expect(p).rejects.toThrow(/重複/);
    expect(runner.done).toBe(true);
    expect(sched.pending).toBe(0);
  });
});
