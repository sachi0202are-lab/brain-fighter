/**
 * ダブルヒットをヘッドレス（仮想時計・60Hz）で動かす試合のテスト。
 * 疑似プレイヤーは src/engine/autoplay.ts（5 試行に1回誤る = 正答率 80%）と、提示時間で正答率が決まる心理測定関数の観察者。
 */
import { describe, expect, it } from 'vitest';
import { correctPlan, wrongPlan } from '../../engine/autoplay';
import { runMatchHeadless, runRoundHeadless, type HeadlessOptions } from '../../engine/headless';
import { runMatch, type RoundDone } from '../../engine/match';
import { toTrialLogs } from '../../engine/records';
import { hashSeed, mulberry32 } from '../../engine/rng';
import type { RoundEvent } from '../../engine/round';
import { median } from '../../engine/stats';
import { quantizeMs } from '../../engine/timing';
import { certRoundPassed, type Response, type ResponseLayout, type RoundOptions } from '../../engine/types';
import { doubleHitText as text } from '../../i18n/ja/double-hit';
import { game, genericTipIndex, PHASE_MS, type DhParams, type DhTrial } from './index';
import { certDhParams, paramsAt } from './params';

const F60 = 1000 / 60;
const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };
const q = (ms: number): number => quantizeMs(ms, F60).ms;
const stimMs = (r: { phases: { name: string; plannedMs: number }[] }): number =>
  r.phases.find((p) => p.name === 'stimulus')?.plannedMs ?? Number.NaN;

/** 提示時間（量子化後）で正答率が決まる観察者（当て推量 1/16、Weibull 傾き 2） */
function psychometric(alphaMs: number, seed: number): Pick<HeadlessOptions, 'plan' | 'onEvent'> {
  const r = mulberry32(seed);
  let shown = 0;
  const p = (T: number): number => 1 / 16 + (15 / 16) * (1 - Math.exp(-((T / alphaMs) ** 2)));
  return {
    onEvent: (e: RoundEvent) => {
      if (e.type === 'phase' && e.phase === 'stimulus') shown = e.plannedMs;
    },
    plan: (c) => (r.chance(p(shown)) ? correctPlan(c.expected) : wrongPlan(c.layout, c.expected)),
  };
}

/** 構えだけ・方向だけ・両方を誤る応答を作る */
function answer(layout: ResponseLayout, expected: Response | null, kind: 'ok' | 'stance' | 'dir' | 'both'): string[] {
  const exp = expected as Response;
  const other = (group: string): string =>
    layout.buttons.find((b) => b.group === group && b.id !== exp[group])?.id as string;
  const stance = kind === 'stance' || kind === 'both' ? other('stance') : (exp.stance as string);
  const dir = kind === 'dir' || kind === 'both' ? other('dir') : (exp.dir as string);
  return [dir, stance];
}

/**
 * 1試合（= 1 ラウンド）を続けて遊び、ラウンドの結果を集める。難度は試合をまたいで引き継ぐ（アプリは保存した state から戻す）。
 * 試合ごとのシードは seed + 試合の番号。
 */
async function playMatches(
  from: DhParams,
  matches: number,
  seed: number,
  opts: HeadlessOptions = {},
): Promise<{ rounds: RoundDone<DhParams, DhTrial>[]; end: DhParams }> {
  let params = from;
  const rounds: RoundDone<DhParams, DhTrial>[] = [];
  for (let m = 0; m < matches; m++) {
    const res = await runMatchHeadless(game, params, { seed: seed + m }, opts);
    expect(res.warmup).toBeNull();
    expect(res.rounds).toHaveLength(1);
    const r = res.rounds[0]!;
    expect(res.paramsEnd).toEqual(r.paramsEnd);
    rounds.push(r);
    params = res.paramsEnd;
  }
  return { rounds, end: params };
}

describe('ヘッドレスの試合（1試合 = 24 試行 × 1 ラウンド）', () => {
  it('1 試合は 1 ラウンドだけ（ウォームアップ・ラウンド間・「もう1ラウンド」なし）。認定戦とは別', async () => {
    expect(game.roundsPerMatch).toBe(1);
    expect(game.extraRounds ?? 0).toBe(0);
    expect(game.createWarmup).toBeUndefined();
    const calls: string[] = [];
    const res = await runMatch(
      { game, params: game.initialParams, surface: 0, previousPower: 0, seedFor: (k, n) => hashSeed(11, game.id, k, n) },
      {
        runRound: (req) => runRoundHeadless(game, req.trials, req.params, req.options, req.adaptive),
        onRoundDone: (d) => void calls.push(`done:${d.summary.kind}:${d.summary.roundNo}:${d.summary.trials}`),
        between: async () => void calls.push('between'),
        askExtra: async () => {
          calls.push('askExtra');
          return true;
        },
      },
    );
    expect(calls).toEqual(['done:round:1:24']);
    expect(res.warmup).toBeNull();
    expect(res.rounds).toHaveLength(1);
    // 1 ラウンドでも T の試行単位の適応・ラウンド末の適応・戦闘力は今までどおり
    const r = res.rounds[0]!;
    expect(r.summary.paramsStart.T).toBe(300);
    expect(r.summary.paramsPlayed.T).toBeLessThan(300);
    expect(res.paramsEnd).toEqual(r.paramsEnd);
    expect(r.power).toBe(game.power(r.summary.paramsPlayed, r.summary));
  });

  it('正答率 80% の自動プレイ: 3 試合とも正答率 75〜85%、T は試合をまたいで短くなっていく', async () => {
    const { rounds, end } = await playMatches(game.initialParams, 3, 20260929);
    const rows = rounds.map((r, m) => ({
      match: m + 1,
      trials: r.summary.trials,
      acc: Math.round(r.summary.accuracy * 1000) / 10,
      tStart: Math.round(q(r.summary.paramsStart.T) * 10) / 10,
      tMedian: r.metrics.tMedian,
      tEnd: r.metrics.tEnd,
      stage: r.metrics.stage,
      power: r.power,
      errors: JSON.stringify(r.summary.errors),
    }));
    console.log(`[double-hit] 80% 自動プレイ（1 試合 1 ラウンド × 3 試合）\n${rows.map((x) => JSON.stringify(x)).join('\n')}`);
    for (const r of rounds) {
      expect(r.summary.trials).toBe(24);
      expect(r.summary.accuracy).toBeGreaterThanOrEqual(0.75);
      expect(r.summary.accuracy).toBeLessThanOrEqual(0.85);
    }
    // 次の試合は前の試合の終わりの T から始まる（T の階段法は試合をまたいで続く）
    expect(rounds[1]!.summary.paramsStart.T).toBeCloseTo(rounds[0]!.paramsEnd.T, 9);
    expect(rounds[2]!.summary.paramsStart.T).toBeCloseTo(rounds[1]!.paramsEnd.T, 9);
    const ends = rounds.map((r) => r.summary.paramsPlayed.T);
    expect(ends[0]!).toBeLessThan(300);
    expect(ends[1]!).toBeLessThan(ends[0]!);
    expect(ends[2]!).toBeLessThan(ends[1]!);
    expect(end.stage).toBe(0);
  }, 30_000);

  it('心理測定関数の観察者: ラウンドの正答率は長い目で約 75%、T はしきい値付近に落ち着く', async () => {
    // alpha = 120 ms → 正答率 75.5% になる T は約 139 ms。1 試合 1 ラウンドなので 36 試合 = 36 ラウンド
    let params = game.initialParams;
    const accs: number[] = [];
    const tEnds: number[] = [];
    for (let m = 0; m < 36; m++) {
      const res = await runMatchHeadless(game, params, { seed: 500 + m }, psychometric(120, 900 + m));
      for (const r of res.rounds) {
        accs.push(r.summary.accuracy);
        tEnds.push(r.summary.paramsPlayed.T);
      }
      params = res.paramsEnd;
    }
    expect(accs).toHaveLength(36);
    const late = accs.slice(3);
    const meanAcc = late.reduce((a, b) => a + b, 0) / late.length;
    const geoT = Math.exp(tEnds.slice(3).reduce((a, t) => a + Math.log(t), 0) / (tEnds.length - 3));
    console.log(
      `[double-hit] 心理測定の観察者 36 試合（各 1 ラウンド）: 正答率 ${accs.map((a) => Math.round(a * 100)).join(' ')}（4 本目以降の平均 ${(meanAcc * 100).toFixed(1)}%）、T の幾何平均 ${geoT.toFixed(0)} ms`,
    );
    expect(meanAcc).toBeGreaterThan(0.7);
    expect(meanAcc).toBeLessThan(0.82);
    expect(geoT).toBeGreaterThan(100);
    expect(geoT).toBeLessThan(190);
    expect(params.stage).toBe(0);
  }, 60_000);

  it('全問正解のプレイヤー: T が下限に達した試合の末にステージが 1 つ上がり（1 試合で最大 1 段）、T は 100 ms に戻る。ステージは 4 で止まる', async () => {
    const plan: HeadlessOptions['plan'] = (c) => correctPlan(c.expected);
    const { rounds, end } = await playMatches(paramsAt(0, 60), 6, 1, { plan });
    expect(rounds.map((r) => r.summary.paramsPlayed.stage)).toEqual([0, 1, 2, 3, 4, 4]);
    expect(rounds.map((r) => r.paramsEnd.stage)).toEqual([1, 2, 3, 4, 4, 4]);
    // 昇格した試合の後は T = 100 から。ステージ 4 は最上位なので T は下限のまま
    expect(rounds.map((r) => r.paramsEnd.T)).toEqual([100, 100, 100, 100, 33, 33]);
    for (const r of rounds) expect(r.paramsEnd.stage - r.summary.paramsStart.stage).toBeLessThanOrEqual(1);
    // 次の試合はラダーの妨害数・偏心度で戦う
    expect(rounds[1]!.summary.results.every((r) => r.trial.distractors.length === 6 && r.trial.eccPct === 35)).toBe(true);
    expect(rounds[2]!.summary.results.every((r) => r.trial.distractors.length === 12)).toBe(true);
    // 戦闘力はステージの境目で連続（stage s・T 33 → 200s+200 = stage s+1・T 500）で、下がらない
    expect(rounds.map((r) => r.power)).toEqual([200, 400, 600, 800, 1000, 1000]);
    // ステージ 4: 構えは 3 種、妨害 48 個、偏心度 45%
    const r4 = rounds[4]!.summary.results;
    expect(new Set(r4.map((r) => r.trial.stance))).toEqual(new Set(['high', 'mid', 'low']));
    expect(r4.every((r) => r.trial.distractors.length === 48 && r.trial.eccPct === 45)).toBe(true);
    expect(end).toEqual(paramsAt(4, 33));
  }, 30_000);

  it('下限にいても正答率が 80% 未満のラウンドでは上がらない', async () => {
    // 5 試行中 2 回誤る（正答率 58%）
    const res = await runMatchHeadless(game, paramsAt(1, 33), { seed: 3 }, {
      plan: (c) => (c.i % 5 < 3 ? correctPlan(c.expected) : wrongPlan(c.layout, c.expected)),
    });
    expect(res.rounds[0]!.summary.accuracy).toBeLessThan(0.8);
    expect(res.paramsEnd.stage).toBe(1);
  });

  it('認定戦（adaptive: false・未訓練セット）: T は全試行で固定、難度も変わらない', async () => {
    for (const tier of [1, 6, 9]) {
      const p = certDhParams(tier);
      const res = await runMatchHeadless(game, p, { seed: 40 + tier, adaptive: false, untrained: true, rounds: 2 });
      expect(res.rounds).toHaveLength(2);
      for (const r of res.rounds) {
        const planned = new Set(r.summary.results.map(stimMs));
        expect([...planned]).toEqual([q(p.T)]);
        expect(r.paramsEnd).toEqual(p);
        expect(r.summary.results.every((x) => x.trial.distractors.length === p.distractors && x.trial.eccPct === p.eccPct)).toBe(true);
      }
      expect(res.paramsEnd).toEqual(p);
    }
  }, 30_000);

  it('認定戦の合否: 24 試行中 19 正答で合格、18 で不合格（第7節）', () => {
    expect(certRoundPassed(game, { trials: 24, correct: 19, accuracy: 19 / 24, errors: {} }, 5)).toBe(true);
    expect(certRoundPassed(game, { trials: 24, correct: 18, accuracy: 18 / 24, errors: {} }, 5)).toBe(false);
  });
});

describe('1 ラウンドの動き', () => {
  it('試行のフェーズ: 注視点 500 → 刺激 T → マスク 150 → 応答（5 秒まで）→ フィードバック 300 → 試行間隔 500', () => {
    const ph = game.phases(game.createRound(game.initialParams, mulberry32(1), OPTS)[0]!, paramsAt(0, 123));
    expect(ph).toEqual([
      { name: 'fixation', ms: 500 },
      { name: 'stimulus', ms: 123 },
      { name: 'mask', ms: 150 },
      { name: 'response', ms: 5000, input: true, untilResponse: true },
      { name: 'feedback', ms: 300 },
      { name: 'iti', ms: 500 },
    ]);
    expect(PHASE_MS).toEqual({ fixation: 500, mask: 150, response: 5000, feedback: 300, iti: 500 });
    // 範囲外・壊れた T でも刺激のフェーズは消えない（33〜500 ms に収める）
    const t0 = game.createRound(game.initialParams, mulberry32(1), OPTS)[0]!;
    expect(game.phases(t0, { ...paramsAt(0, 100), T: 5 })[1]).toEqual({ name: 'stimulus', ms: 33 });
    expect(game.phases(t0, { ...paramsAt(0, 100), T: 9000 })[1]).toEqual({ name: 'stimulus', ms: 500 });
    expect(game.phases(t0, { ...paramsAt(0, 100), T: Number.NaN })[1]).toEqual({ name: 'stimulus', ms: 300 });
  });

  it('提示時間は試行ごとに T を反映し、フレームに丸めた値が記録される（TrialLog.plan / stimMs）', async () => {
    const trials = game.createRound(game.initialParams, mulberry32(8), OPTS);
    const s = await runRoundHeadless(game, trials, game.initialParams, OPTS, true);
    let T = 300;
    const logs = toTrialLogs('r1', s.results);
    s.results.forEach((r, i) => {
      expect(r.params.T).toBeCloseTo(T, 9);
      expect(stimMs(r)).toBeCloseTo(q(T), 9);
      expect(logs[i]!.plan?.stimulus).toBeCloseTo(Math.round(q(T) * 10) / 10, 6);
      expect(logs[i]!.stimMs).toBeCloseTo(Math.round(q(T) * 10) / 10, 6);
      T = Math.min(500, Math.max(33, T * (r.correct ? 0.93 : 1.25)));
    });
    expect(s.paramsPlayed.T).toBeCloseTo(T, 9);
  });

  it('構えと方向はどちらの順に答えてもよい。片方だけで 5 秒たつと timeout、無応答も timeout', async () => {
    const trials = game.createRound(game.initialParams, mulberry32(12), OPTS);
    const dirFirst = await runRoundHeadless(game, trials, game.initialParams, OPTS, true, {
      plan: (c) => {
        const e = c.expected as Response;
        return [e.dir as string, e.stance as string];
      },
    });
    expect(dirFirst.correct).toBe(24);
    const onlyStance = await runRoundHeadless(game, trials, game.initialParams, OPTS, true, {
      plan: (c) => [(c.expected as Response).stance as string],
    });
    expect(onlyStance.errors).toEqual({ timeout: 24 });
    // 応答窓は 5 秒（フレームに丸めた値）で閉じる
    for (const r of onlyStance.results) {
      const resp = r.phases.find((p) => p.name === 'response')!;
      expect(resp.endMs - resp.startMs).toBeCloseTo(q(5000), 6);
      expect(r.rtMs).toBeUndefined();
    }
    const none = await runRoundHeadless(game, trials, game.initialParams, OPTS, true, { plan: () => [] });
    expect(none.errors).toEqual({ timeout: 24 });
    expect(none.paramsPlayed.T).toBe(500);
  });

  it('記録: ラウンド末の T・T の中央値（提示値）、構え／火花／両方の正答率、ステージ。誤答の内訳は kind ごと', async () => {
    const params = paramsAt(2, 150);
    const trials = game.createRound(params, mulberry32(21), OPTS);
    const kinds = ['ok', 'stance', 'dir', 'both', 'ok', 'ok'] as const;
    const s = await runRoundHeadless(game, trials, params, OPTS, true, {
      plan: (c) => answer(c.layout, c.expected, kinds[c.i % kinds.length]!),
    });
    expect(s.errors).toEqual({ stance: 4, dir: 4, both: 4 });
    expect(s.correct).toBe(12);
    const m = game.metrics!(s, { warmup: null });
    expect(m).toEqual({
      tEnd: Math.round(q(s.paramsPlayed.T) * 10) / 10,
      tMedian: Math.round((median(s.results.map(stimMs)) as number) * 10) / 10,
      accStance: Math.round((16 / 24) * 1000) / 1000,
      accDir: Math.round((16 / 24) * 1000) / 1000,
      accBoth: 0.5,
      stage: 2,
    });
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });

  it('速さは戦闘力・適応に影響しない（同じ正誤で反応時間だけ変える）', async () => {
    const trials = game.createRound(game.initialParams, mulberry32(77), OPTS);
    const run = (delayMs: number) => runRoundHeadless(game, trials, game.initialParams, OPTS, true, { delayMs });
    const fast = await run(40);
    const slow = await run(4200);
    expect(fast.results.map((r) => r.correct)).toEqual(slow.results.map((r) => r.correct));
    expect(fast.rtMedianMs as number).toBeLessThan(slow.rtMedianMs as number);
    expect(fast.paramsPlayed).toEqual(slow.paramsPlayed);
    expect(game.power(fast.paramsPlayed, fast)).toBe(game.power(slow.paramsPlayed, slow));
    expect(game.adapt!(fast.paramsPlayed, fast)).toEqual(game.adapt!(slow.paramsPlayed, slow));
    expect(game.metrics!(fast, { warmup: null })).toEqual(game.metrics!(slow, { warmup: null }));
  });

  it('ラウンド末の一言は誤りの内訳に合わせて選ぶ（決定的）', async () => {
    const params = paramsAt(1, 150);
    const trials = game.createRound(params, mulberry32(5), OPTS);
    const play = (kind: 'ok' | 'stance' | 'dir', every: number) =>
      runRoundHeadless(game, trials, params, OPTS, true, {
        plan: (c) => answer(c.layout, c.expected, c.i % every === 0 ? kind : 'ok'),
      });
    const stanceHeavy = await play('stance', 4);
    const dirHeavy = await play('dir', 4);
    const clean = await play('ok', 1);
    const tips = [game.roundTip!(stanceHeavy), game.roundTip!(dirHeavy), game.roundTip!(clean)];
    expect(new Set(tips).size).toBe(3);
    for (const t of tips) expect(t.length).toBeGreaterThan(0);
    expect(game.roundTip!(stanceHeavy)).toBe(game.roundTip!(stanceHeavy));
  });

  it('傾向の無いラウンドの一言は、正答数とラウンド番号で順に替える（1試合 1 ラウンドでも毎回同じにならない）', async () => {
    // 構えだけ 2 回・方向だけ 2 回の誤り（20 / 24 正答 = 83%）: 時間切れも偏りも無く、85% 未満 → 汎用の一言
    const params = paramsAt(1, 150);
    const trials = game.createRound(params, mulberry32(6), OPTS);
    const kinds = ['stance', 'stance', 'dir', 'dir'] as const;
    const s = await runRoundHeadless(game, trials, params, OPTS, true, {
      plan: (c) => answer(c.layout, c.expected, kinds[c.i] ?? 'ok'),
    });
    expect(s.errors).toEqual({ stance: 2, dir: 2 });
    expect(s.roundNo).toBe(1);
    const n = text.tips.length;
    expect(game.roundTip!(s)).toBe(text.tips[genericTipIndex(s, n)]);
    // 1 ラウンドの試合（roundNo = 1）でも、正答数が違えば別の一言になり、どの一言も出る
    const byCorrect = [18, 19, 20].map((correct) => game.roundTip!({ ...s, correct }));
    expect(new Set(byCorrect).size).toBe(n);
    expect([...byCorrect].sort()).toEqual([...text.tips].sort());
    // ラウンド番号が 1 つ進めば次の一言（今までの順番どおり）
    const byRound = [1, 2, 3].map((roundNo) => game.roundTip!({ ...s, roundNo }));
    const start = genericTipIndex(s, n);
    expect(byRound).toEqual([0, 1, 2].map((k) => text.tips[(start + k) % n]));
    expect(genericTipIndex({ roundNo: 1, correct: 0 }, n)).toBe(0);
    expect(genericTipIndex({ roundNo: 0, correct: -3 }, n)).toBe(0);
  });

  it('ラウンドのルールの一言（roundIntro）はステージの内容を表す', () => {
    const intros = [0, 1, 2, 3, 4].map((s) => game.roundIntro!(paramsAt(s, 100), { kind: 'round', roundNo: 1 }));
    expect(new Set(intros).size).toBe(5);
    expect(intros[1]).toContain('6');
    expect(intros[4]).toContain('中段');
  });
});
