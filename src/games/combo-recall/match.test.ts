/**
 * コンボ・リコールをエンジン（RoundRunner・runMatch）で動かすテスト（仮想時計・ブラウザ無し）。
 * - 固定タイミング（1 試行 2.5 秒、押しても次の刺激の時刻は同じ）と反応時間の起点
 * - 1 試合（1 ラウンド。v1.2 で「もう1ラウンド」は廃止）、速さ非依存、演出プリセット同値性（このゲームだけで）
 * - 正答率 80% の疑似プレイヤーで数試合回したときの n と誤りの推移（`--silent=false` で表が出る）
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { correctPlan, every5thWrong, wrongPlan } from '../../engine/autoplay';
import { driveRunner, runMatchHeadless, runRoundHeadless } from '../../engine/headless';
import { runMatch, surfaceIndex, type RoundDone } from '../../engine/match';
import { toTrialLogs } from '../../engine/records';
import { hashSeed, mulberry32, type Rng } from '../../engine/rng';
import { RoundRunner } from '../../engine/round';
import { nbackStep } from '../../engine/staircase';
import { VirtualScheduler } from '../../engine/timing';
import type { RoundOptions } from '../../engine/types';
import { enemyHp } from '../../skin/hp';
import { Hud } from '../../skin/hud';
import type { SoundPlayer } from '../../skin/sound';
import { FX_PRESETS, type FxPreset, type TrialLog } from '../../storage/schema';
import { installFakeDocument } from '../../test/fake-dom';
import { ATTACK, game, type CrParams, type CrTrial } from './index';

// 並行作業で CPU が詰まった環境でも時間切れにしない（どのテストも通常は 1 秒未満）
vi.setConfig({ testTimeout: 60_000 });

const F = 1000 / 60;
const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };

describe('固定タイミング（点灯 500 ms → 消灯 2,000 ms、この 2.5 秒ずっと応答可）', () => {
  const trials = game.createRound({ n: 2 }, mulberry32(3), OPTS);
  const run = (plan: () => string[], delayMs: number) =>
    runRoundHeadless(game, trials, { n: 2 }, OPTS, true, { plan, delayMs });

  it('押す時刻・押さないに関係なく、1 試行 = 2.5 秒（30 + 120 フレーム）', async () => {
    const early = await run(() => [ATTACK], 100);
    const late = await run(() => [ATTACK], 2200);
    const never = await run(() => [], 0);
    for (const s of [early, late, never]) {
      expect(s.results).toHaveLength(22);
      s.results.forEach((r, i) => {
        expect(r.onsetMs).toBeCloseTo(i * 2500, 6);
        const stim = r.phases.find((p) => p.name === 'stimulus')!;
        const dark = r.phases.find((p) => p.name === 'response')!;
        expect([stim.frames, dark.frames]).toEqual([30, 120]);
        expect(stim.endMs - stim.startMs).toBeCloseTo(500, 6);
        expect(dark.endMs - dark.startMs).toBeCloseTo(2000, 6);
        expect(dark.startMs).toBeCloseTo(stim.endMs, 9);
      });
    }
    // 1ラウンドの長さ（n = 2 で 55 秒）
    const last = never.results.at(-1)!;
    expect(last.phases.at(-1)!.endMs).toBeCloseTo(22 * 2500, 6);
  });

  it('消灯中（2.2 秒後）の押しも受け付け、反応時間は点灯の瞬間から測る', async () => {
    const early = await run(() => [ATTACK], 100);
    const late = await run(() => [ATTACK], 2200);
    for (const r of early.results) {
      expect(r.response).toEqual({ main: ATTACK });
      expect(r.rtMs!).toBeGreaterThanOrEqual(100 - 1e-6);
      expect(r.rtMs!).toBeLessThan(100 + F);
    }
    for (const r of late.results) {
      expect(r.response).toEqual({ main: ATTACK });
      expect(r.rtMs!).toBeGreaterThanOrEqual(2200 - 1e-6);
      expect(r.rtMs!).toBeLessThan(2200 + F);
      // 標的なら消灯中の押しでもヒット
      expect(r.correct).toBe(r.trial.target);
    }
    // 反応時間の中央値（記録用）は正しく押した試行（ヒット）だけ
    expect(late.rtMedianMs).toBeGreaterThanOrEqual(2200 - 1e-6);
  });

  it('押さなかった試行は応答窓の終わり（次の点灯の直前）に判定される', async () => {
    const never = await run(() => [], 0);
    expect(never.correct).toBe(22 - 6);
    expect(never.errors).toEqual({ miss: 6 });
    expect(never.results.every((r) => r.rtMs === undefined)).toBe(true);
  });

  it('ラウンドの長さは n = 1 で 52.5 秒、n = 9 で 72.5 秒（試行数 20 + n × 2.5 秒）', () => {
    for (const n of [1, 9]) {
      const t = game.createRound({ n }, mulberry32(n), OPTS);
      const perTrial = game.phases(t[0]!, { n }).reduce((a, p) => a + p.ms, 0);
      expect((t.length * perTrial) / 1000).toBe(n === 1 ? 52.5 : 72.5);
    }
  });
});

describe('1 試合（エンジンの runMatch）', () => {
  it('1 ラウンド（仕様書 v1.2）、戦闘力は 0〜1000 の整数、記録は有限の数値', async () => {
    const res = await runMatchHeadless(game, game.initialParams, { seed: 123 });
    expect(res.rounds).toHaveLength(1);
    expect(res.warmup).toBeNull();
    for (const r of res.rounds) {
      expect(Number.isInteger(r.power)).toBe(true);
      expect(r.power).toBeGreaterThanOrEqual(0);
      expect(r.power).toBeLessThanOrEqual(1000);
      for (const v of Object.values(r.metrics)) expect(Number.isFinite(v)).toBe(true);
      expect(r.metrics.n).toBe(r.summary.paramsPlayed.n);
      expect(r.summary.trials).toBe(20 + r.summary.paramsPlayed.n);
      expect(r.paramsEnd).toEqual({ n: nbackStep(r.summary.paramsPlayed.n, r.summary.trials - r.summary.correct) });
    }
  });

  it('「もう1ラウンド」は無い（extra: true と答えても 1 ラウンドで終わる。仕様書 v1.2）', async () => {
    const res = await runMatchHeadless(game, game.initialParams, { seed: 5 }, { extra: true });
    expect(res.rounds.map((r) => r.summary.roundNo)).toEqual([1]);
    expect(game.extraRounds).toBeUndefined();
  });

  it('速さは戦闘力と次の n に影響しない（同じ正誤で、押す時刻だけ 80 ms と 1,800 ms）', async () => {
    for (const n of [1, 4]) {
      const trials = game.createRound({ n }, mulberry32(77 + n), OPTS);
      const fast = await runRoundHeadless(game, trials, { n }, OPTS, true, { delayMs: 80 });
      const slow = await runRoundHeadless(game, trials, { n }, OPTS, true, { delayMs: 1800 });
      expect(fast.results.map((r) => r.correct)).toEqual(slow.results.map((r) => r.correct));
      expect(fast.rtMedianMs).not.toBe(slow.rtMedianMs);
      expect(game.power(fast.paramsPlayed, fast)).toBe(game.power(slow.paramsPlayed, slow));
      expect(game.adapt!(fast.paramsPlayed, fast)).toEqual(game.adapt!(slow.paramsPlayed, slow));
    }
  });

  it('認定戦の形（未訓練セット・適応なし・2 ラウンド）で動かすと n は変わらない', async () => {
    const res = await runMatchHeadless(game, game.certParams(4), { seed: 9, untrained: true, adaptive: false, rounds: 2, allowExtra: false });
    expect(res.rounds).toHaveLength(2);
    for (const r of res.rounds) {
      expect(r.summary.paramsPlayed).toEqual({ n: 4 });
      expect(r.summary.results.every((t) => t.trial.ring && t.stim.startsWith('r'))).toBe(true);
    }
    expect(res.paramsEnd).toEqual({ n: 4 });
  });
});

// ---------------------------------------------------------------------------
// 演出プリセット同値性（src/engine/fx-equivalence.test.ts と同じ方法を、このゲームだけで）

describe('演出プリセット同値性（off / light / full）', () => {
  let restoreDom: () => void;
  beforeAll(() => {
    restoreDom = installFakeDocument();
  });
  afterAll(() => restoreDom());

  async function play(fx: FxPreset): Promise<{ logs: TrialLog[]; ends: unknown[]; sounds: number }> {
    let sounds = 0;
    const sound = { play: () => sounds++, unlock: () => {} } as unknown as SoundPlayer;
    const hud = new Hud({ preset: fx, sound });
    const logs: TrialLog[] = [];
    const ends: unknown[] = [];
    const recent: number[] = [];
    await runMatch<CrParams, CrTrial>(
      { game, params: { n: 3 }, surface: 1, previousPower: 0, seedFor: (kind, n) => hashSeed(20260929, game.id, kind, n) },
      {
        runRound: async (req) => {
          const sched = new VirtualScheduler();
          const runner = new RoundRunner({ game, trials: req.trials, params: req.params, options: req.options, adaptive: req.adaptive, scheduler: sched });
          hud.setInfo({ label: `R${req.roundNo}`, level: game.enemyLevel(req.params), enemyName: 'X', warmup: false });
          const detach = hud.attach(runner.events, { trials: req.trials.length, enemyHp: enemyHp(req.trials.length, recent) });
          try {
            return await driveRunner(runner, sched, { delayMs: (i) => 120 + (i % 3) * 700 });
          } finally {
            detach();
          }
        },
        onRoundDone: (d) => {
          logs.push(...toTrialLogs(`r${d.summary.roundNo}`, d.summary.results));
          ends.push({ paramsEnd: d.paramsEnd, power: d.power, metrics: d.metrics });
          recent.push(d.summary.accuracy);
        },
        askExtra: async () => true,
      },
    );
    hud.destroy();
    return { logs, ends, sounds };
  }

  it('試行数・各フェーズの予定と実測・刺激・応答・正誤・反応時間・難度・戦闘力が一致する', async () => {
    const played: Awaited<ReturnType<typeof play>>[] = [];
    for (const fx of FX_PRESETS) played.push(await play(fx));
    const [off, light, full] = played;
    expect(off!.logs.length).toBe(23); // n = 3 の 1 ラウンド
    expect(light!.logs).toEqual(off!.logs);
    expect(full!.logs).toEqual(off!.logs);
    expect(light!.ends).toEqual(off!.ends);
    expect(full!.ends).toEqual(off!.ends);
    expect(off!.sounds).toBe(0);
    expect(light!.sounds).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 正答率 80% の疑似プレイヤーで数試合（n は試合をまたいで引き継ぐ。アプリと同じ）

interface Row {
  match: number;
  round: number;
  n: number;
  trials: number;
  misses: number;
  falseAlarms: number;
  lureFalseAlarms: number;
  errors: number;
  accuracy: number;
  nextN: number;
  power: number;
}

type Decide = (ctx: { n: number; i: number; rng: Rng }) => boolean;

async function simulate(matches: number, seed: number, decide: Decide): Promise<Row[]> {
  const rows: Row[] = [];
  const rng = mulberry32(hashSeed(seed, 'bot'));
  let params: CrParams = { ...game.initialParams };
  for (let m = 1; m <= matches; m++) {
    const res = await runMatch<CrParams, CrTrial>(
      {
        game,
        params,
        surface: surfaceIndex(m - 1, game.surfaceCount),
        previousPower: 0,
        seedFor: (kind, r) => hashSeed(seed, m, kind, r),
      },
      {
        runRound: (req) =>
          runRoundHeadless(game, req.trials, req.params, req.options, req.adaptive, {
            delayMs: 350,
            plan: ({ i, expected, layout }) =>
              decide({ n: req.params.n, i, rng }) ? correctPlan(expected) : wrongPlan(layout, expected),
          }),
        onRoundDone: (d: RoundDone<CrParams, CrTrial>) => {
          const s = d.summary;
          rows.push({
            match: m,
            round: s.roundNo,
            n: s.paramsPlayed.n,
            trials: s.trials,
            misses: d.metrics.misses as number,
            falseAlarms: d.metrics.falseAlarms as number,
            lureFalseAlarms: d.metrics.lureFalseAlarms as number,
            errors: s.trials - s.correct,
            accuracy: s.accuracy,
            nextN: d.paramsEnd.n,
            power: d.power,
          });
        },
        askExtra: async () => false,
      },
    );
    params = res.paramsEnd;
  }
  return rows;
}

function report(title: string, rows: Row[]): void {
  const lines = [title];
  for (let m = 1; m <= Math.max(...rows.map((r) => r.match)); m++) {
    const rs = rows.filter((r) => r.match === m);
    const cells = rs.map((r) => `n=${r.n} 誤り${r.errors}(見${r.misses}/誤${r.falseAlarms}${r.lureFalseAlarms ? `,ル${r.lureFalseAlarms}` : ''}) ${Math.round(r.accuracy * 100)}% 力${r.power}`);
    lines.push(`  試合${m}: ${cells.join(' → ')} → 次 n=${rs.at(-1)!.nextN}`);
  }
  const acc = rows.reduce((a, r) => a + r.accuracy * r.trials, 0) / rows.reduce((a, r) => a + r.trials, 0);
  lines.push(`  全体の正答率 ${(acc * 100).toFixed(1)}%、n の範囲 ${Math.min(...rows.map((r) => r.n))}〜${Math.max(...rows.map((r) => r.n))}`);
  console.log(lines.join('\n'));
}

function checkRules(rows: Row[]): void {
  for (const r of rows) {
    expect(r.n).toBeGreaterThanOrEqual(1);
    expect(r.n).toBeLessThanOrEqual(9);
    expect(r.trials).toBe(20 + r.n);
    expect(r.errors).toBe(r.misses + r.falseAlarms);
    expect(r.nextN).toBe(nbackStep(r.n, r.errors));
  }
  // 試合・ラウンドをまたいで n が引き継がれる
  for (let k = 1; k < rows.length; k++) expect(rows[k]!.n).toBe(rows[k - 1]!.nextN);
}

describe('正答率 80% の疑似プレイヤー（ヘッドレス）', () => {
  it('5 試行に 1 回誤る（エンジンの既定の疑似プレイヤー）: 誤り 4 で n = 1 のまま', async () => {
    const rows = await simulate(4, 1, ({ i }) => every5thWrong(i));
    report('[5 試行に 1 回誤る]', rows);
    checkRules(rows);
    // 21 試行中 i = 4, 9, 14, 19 の 4 回だけ誤る → 誤り 3〜5 は維持
    expect(rows.every((r) => r.n === 1 && r.errors === 4)).toBe(true);
  });

  it('各試行を確率 80% で正解（5 人 × 24 試合）: n が上下し、誤りと n の変化はルールどおり', async () => {
    const all: Row[] = [];
    for (let bot = 1; bot <= 5; bot++) {
      const rows = await simulate(24, bot, ({ rng }) => rng.next() < 0.8);
      if (bot === 1) report('[各試行 80% で正解・1 人目]', rows);
      checkRules(rows);
      all.push(...rows);
    }
    const trials = all.reduce((a, r) => a + r.trials, 0);
    const acc = all.reduce((a, r) => a + r.accuracy * r.trials, 0) / trials;
    const up = all.filter((r) => r.nextN > r.n).length;
    const down = all.filter((r) => r.nextN < r.n).length;
    const hist = new Map<number, number>();
    for (const r of all) hist.set(r.errors, (hist.get(r.errors) ?? 0) + 1);
    const nHist = new Map<number, number>();
    for (const r of all) nHist.set(r.n, (nHist.get(r.n) ?? 0) + 1);
    console.log(
      [
        `[各試行 80% で正解・5 人 × 24 試合 = ${all.length} ラウンド、${trials} 試行]`,
        `  正答率 ${(acc * 100).toFixed(1)}%、n+1: ${up} 回、維持: ${all.length - up - down} 回、n−1: ${down} 回`,
        `  誤りの分布: ${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([e, c]) => `${e}:${c}`).join(' ')}`,
        `  n の分布: ${[...nHist.entries()].sort((a, b) => a[0] - b[0]).map(([n, c]) => `n=${n}:${c}`).join(' ')}`,
      ].join('\n'),
    );
    expect(acc).toBeGreaterThan(0.77);
    expect(acc).toBeLessThan(0.83);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeGreaterThan(0);
  });

  it('n が上がるほど誤りやすいプレイヤー（正答率 = 1 − 0.03n）: 誤り 3〜5 の帯に n が落ち着く', async () => {
    const rows = await simulate(24, 3, ({ n, rng }) => rng.next() < 1 - 0.03 * n);
    report('[正答率 1 − 0.03n]', rows);
    checkRules(rows);
    const late = rows.slice(Math.floor(rows.length / 2));
    const meanN = late.reduce((a, r) => a + r.n, 0) / late.length;
    expect(meanN).toBeGreaterThanOrEqual(4);
    expect(meanN).toBeLessThanOrEqual(7);
  });
});
