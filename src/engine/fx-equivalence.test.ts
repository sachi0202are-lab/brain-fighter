/**
 * 演出プリセット同値性テスト（仕様書 9.1 MUST・受け入れ基準 1）。
 * 同じシード・同じ入力で off / light / full を実行し、試行ログ（試行数・提示時間・刺激間隔・応答期限・
 * 標的比率が読み取れる刺激）が完全に一致することを確かめる。演出には本物の HUD（skin/hud.ts）を購読させる。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GAMES } from '../games';
import { enemyHp } from '../skin/hp';
import { Hud } from '../skin/hud';
import type { SoundPlayer } from '../skin/sound';
import { FX_PRESETS, GAME_IDS, type FxPreset, type TrialLog } from '../storage/schema';
import { installFakeDocument } from '../test/fake-dom';
import { driveRunner } from './headless';
import { runMatch } from './match';
import { toTrialLogs } from './records';
import { hashSeed } from './rng';
import { RoundRunner } from './round';
import { VirtualScheduler } from './timing';
import type { AnyGameModule } from './types';

let restoreDom: () => void;
beforeAll(() => {
  restoreDom = installFakeDocument();
});
afterAll(() => restoreDom());

interface Played {
  logs: TrialLog[];
  rounds: { kind: string; trials: number; correct: number; paramsEnd: Record<string, number>; power: number }[];
  sounds: number;
  feedbackShown: number;
}

async function play(game: AnyGameModule, fx: FxPreset, seed: number): Promise<Played> {
  let sounds = 0;
  let feedbackShown = 0;
  const sound = { play: () => sounds++, unlock: () => {} } as unknown as SoundPlayer;
  const hud = new Hud({ preset: fx, sound });
  const logs: TrialLog[] = [];
  const rounds: Played['rounds'] = [];
  const recent: number[] = [];
  await runMatch(
    {
      game,
      params: game.initialParams,
      surface: 0,
      previousPower: 0,
      seedFor: (kind, n) => hashSeed(seed, game.id, kind, n),
    },
    {
      runRound: async (req) => {
        const sched = new VirtualScheduler();
        const runner = new RoundRunner({ game, trials: req.trials, params: req.params, options: req.options, adaptive: req.adaptive, scheduler: sched });
        hud.setInfo({ label: `R${req.roundNo}`, level: game.enemyLevel(req.params), enemyName: 'X', warmup: req.kind === 'warmup' });
        const detach = hud.attach(runner.events, { trials: req.trials.length, enemyHp: req.kind === 'round' ? enemyHp(req.trials.length, recent) : null });
        // Full ではさらに「行儀の悪い」購読者も付ける（例外を投げ、状態を覗く）
        const offs =
          fx === 'full'
            ? [
                runner.events.onAny(() => {
                  runner.snapshot();
                  throw new Error('noisy skin');
                }),
              ]
            : [];
        runner.events.on('judged', () => feedbackShown++);
        try {
          return await driveRunner(runner, sched, { delayMs: (i) => 120 + (i % 3) * 90 });
        } finally {
          detach();
          for (const off of offs) off();
        }
      },
      onRoundDone: (d) => {
        logs.push(...toTrialLogs(`${d.summary.kind}-${d.summary.roundNo}`, d.summary.results));
        rounds.push({ kind: d.summary.kind, trials: d.summary.trials, correct: d.summary.correct, paramsEnd: d.paramsEnd, power: d.power });
        if (d.summary.kind === 'round') recent.push(d.summary.accuracy);
      },
      askExtra: async () => true,
    },
  );
  hud.destroy();
  return { logs, rounds, sounds, feedbackShown };
}

describe.each(GAME_IDS)('演出プリセット同値性: %s', (id) => {
  it('off / light / full で試行ログが完全一致する', async () => {
    const game = GAMES[id];
    const origError = console.error;
    console.error = () => {};
    try {
      const results = new Map<FxPreset, Played>();
      for (const fx of FX_PRESETS) results.set(fx, await play(game, fx, 20260929));
      const off = results.get('off')!;
      expect(off.logs.length).toBeGreaterThan(0);
      for (const fx of ['light', 'full'] as const) {
        const other = results.get(fx)!;
        // 試行数
        expect(other.logs.length).toBe(off.logs.length);
        // 提示時間・刺激間隔（各フェーズの予定と実測）・応答期限・刺激（標的比率）・応答・正誤・RT
        expect(other.logs).toEqual(off.logs);
        expect(other.rounds).toEqual(off.rounds);
      }
      // 演出が実際に動いていたこと（Off は音なし、Light/Full は正誤音あり）
      expect(off.sounds).toBe(0);
      expect(results.get('light')!.sounds).toBeGreaterThan(0);
      expect(results.get('full')!.feedbackShown).toBe(off.feedbackShown);
    } finally {
      console.error = origError;
    }
  });
});
