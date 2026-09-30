/**
 * 認定戦（仕様書 第7節・受け入れ基準 6）: 解放条件（訓練 3 日以上・前回から 7 日以上）、固定難度（適応しない）、
 * 未訓練の刺激セット、2 ラウンドとも合格でベルト +1、不合格でベルトは下がらない、訓練量・戦闘力に数えない。
 */
import { describe, expect, it } from 'vitest';
import { correctPlan, wrongPlan } from '../engine/autoplay';
import { runRoundHeadless, type HeadlessOptions } from '../engine/headless';
import { hashSeed, mulberry32 } from '../engine/rng';
import type { GameModule, Params, RoundOptions, RoundStats } from '../engine/types';
import { GAMES } from '../games';
import { defaultSaveData } from '../storage/storage';
import { GAME_IDS, type SaveData } from '../storage/schema';
import { fakeGame, type FakeParams } from '../test/fake-game';
import {
  addCertRound,
  availableCertGames,
  beginCert,
  CERT_ROUNDS,
  certStatus,
  certTier,
  finishCert,
  isIncomplete,
  judgeCert,
  MAX_BELT,
} from './cert';
import { certParamsOf, certRoundIntro, runCert } from './runner';

const at = (y: number, mo: number, d: number, h = 12): Date => new Date(y, mo - 1, d, h);
const days = (...ds: number[]): string[] => ds.map((d) => `2026-09-${String(d).padStart(2, '0')}`);
const stats = (trials: number, correct: number): RoundStats => ({ trials, correct, accuracy: correct / trials, errors: {} });

/** GameModule の呼び出しを数える包み（クラスのインスタンスでも動くように prototype で委譲する） */
function spy<P extends Params, T>(game: GameModule<P, T>) {
  const calls = {
    adapt: 0,
    adaptTrial: 0,
    power: 0,
    warmup: 0,
    rounds: [] as { params: P; opts: RoundOptions; trials: number }[],
    phaseParams: [] as P[],
    renderUntrained: [] as boolean[],
  };
  const g = Object.create(game) as GameModule<P, T>;
  Object.assign(g, {
    createRound: (p: P, rng: Parameters<GameModule<P, T>['createRound']>[1], o: RoundOptions) => {
      const trials = game.createRound(p, rng, o);
      calls.rounds.push({ params: { ...p }, opts: { ...o }, trials: trials.length });
      return trials;
    },
    createWarmup: (p: P, rng: Parameters<GameModule<P, T>['createRound']>[1], o: RoundOptions) => {
      calls.warmup += 1;
      return game.createWarmup ? game.createWarmup(p, rng, o) : [];
    },
    phases: (t: T, p: P) => {
      calls.phaseParams.push({ ...p });
      return game.phases(t, p);
    },
    adapt: (...a: Parameters<NonNullable<GameModule<P, T>['adapt']>>) => {
      calls.adapt += 1;
      return game.adapt ? game.adapt(...a) : a[0];
    },
    adaptTrial: (...a: Parameters<NonNullable<GameModule<P, T>['adaptTrial']>>) => {
      calls.adaptTrial += 1;
      return game.adaptTrial ? game.adaptTrial(...a) : a[0];
    },
    power: (...a: Parameters<GameModule<P, T>['power']>) => {
      calls.power += 1;
      return game.power(...a);
    },
    renderStimulus: (...a: Parameters<GameModule<P, T>['renderStimulus']>) => {
      calls.renderUntrained.push(a[4].untrained);
      game.renderStimulus(...a);
    },
  });
  return { game: g, calls };
}

/** 何もしない描画先（renderStimulus を通す） */
const nullSurface = {
  begin: () => ({ ctx: new Proxy({}, { get: () => () => undefined, set: () => true }) as unknown as CanvasRenderingContext2D, size: 300 }),
};

async function certHeadless<P extends Params, T>(
  game: GameModule<P, T>,
  tier: number,
  opts: HeadlessOptions & { between?: () => void; onRound?: (passed: boolean) => void } = {},
) {
  return runCert(
    { game, tier, seedFor: (n) => hashSeed(2026, game.id, 'cert', n) },
    {
      runRound: (req) => runRoundHeadless(game, req.trials, req.params, req.options, req.adaptive, opts),
      onRoundDone: (_s, info) => opts.onRound?.(info.passed),
      between: async () => opts.between?.(),
    },
  );
}

const allCorrect: HeadlessOptions['plan'] = ({ expected }) => correctPlan(expected);
const allWrong: HeadlessOptions['plan'] = ({ expected, layout }) => wrongPlan(layout, expected);

describe('解放条件（仕様書 第7節「いつ」）', () => {
  it('訓練 3 日以上で挑める。2 日までは挑めない', () => {
    const d = defaultSaveData();
    const g = d.games['double-hit'];
    g.trainingDays = days(1, 2);
    expect(certStatus(g, at(2026, 9, 29)).available).toBe(false);
    expect(certStatus(g, at(2026, 9, 29)).daysOk).toBe(false);
    g.trainingDays = days(1, 2, 3);
    expect(certStatus(g, at(2026, 9, 29)).available).toBe(true);
    expect(availableCertGames(d, at(2026, 9, 29))).toEqual(['double-hit']);
  });

  it('前回の認定戦から 7 日たつまでは挑めない（合否にかかわらず）', () => {
    const g = { ...defaultSaveData().games['combo-recall'], trainingDays: days(1, 2, 3, 4) };
    g.lastCertAt = at(2026, 9, 22, 20).toISOString();
    const six = certStatus(g, at(2026, 9, 28, 23));
    expect(six.available).toBe(false);
    expect(six.intervalOk).toBe(false);
    expect(six.nextDate).toBe('2026-09-29');
    expect(certStatus(g, at(2026, 9, 29, 0)).available).toBe(true);
  });

  it('受けるティアは「現在のベルト + 1」。最上位（黒帯二段）より上は無い', () => {
    expect(certTier(0)).toBe(1);
    expect(certTier(4)).toBe(5);
    expect(certTier(8)).toBe(9);
    expect(certTier(MAX_BELT)).toBeNull();
    const g = { ...defaultSaveData().games['stance-change'], trainingDays: days(1, 2, 3), belt: 9 };
    const s = certStatus(g, at(2026, 9, 29));
    expect(s.maxed).toBe(true);
    expect(s.available).toBe(false);
  });
});

describe('合否（2 ラウンドとも合格で合格）', () => {
  const dh = fakeGame();
  it('既定: 1ラウンドの正答率 79% 以上で合格（24 試行中 19、16 試行中 13）', () => {
    expect(judgeCert(dh, 1, [stats(24, 19), stats(24, 19)]).passed).toBe(true);
    expect(judgeCert(dh, 1, [stats(24, 19), stats(24, 18)])).toEqual({ roundPassed: [true, false], passed: false });
    expect(judgeCert(dh, 1, [stats(16, 13), stats(16, 13)]).passed).toBe(true);
    expect(judgeCert(dh, 1, [stats(16, 12), stats(16, 16)])).toEqual({ roundPassed: [false, true], passed: false });
  });

  it('スタンスチェンジ（2 ラウンド × 16 試行）: 13 / 16（81%）以上で合格、12 / 16（75%）は不合格', () => {
    const sc = GAMES['stance-change'];
    expect(judgeCert(sc, 1, [stats(16, 13), stats(16, 13)])).toEqual({ roundPassed: [true, true], passed: true });
    expect(judgeCert(sc, 6, [stats(16, 16), stats(16, 12)])).toEqual({ roundPassed: [true, false], passed: false });
    for (let c = 0; c <= 16; c++) expect(judgeCert(sc, 9, [stats(16, c), stats(16, c)]).passed, `${c} / 16`).toBe(c >= 13);
  });

  it('ラウンドが 2 本そろわなければ不合格', () => {
    expect(judgeCert(dh, 1, [stats(24, 24)]).passed).toBe(false);
    expect(judgeCert(dh, 1, []).passed).toBe(false);
  });

  it('コンボ・リコールは「誤り 4 以下」（n = 9 の 29 試行でも 5 誤りは不合格）', () => {
    const cr = GAMES['combo-recall'];
    expect(judgeCert(cr, 9, [stats(29, 25), stats(29, 25)]).passed).toBe(true);
    expect(judgeCert(cr, 9, [stats(29, 25), stats(29, 24)]).passed).toBe(false);
    expect(judgeCert(cr, 1, [stats(21, 17), stats(21, 17)]).passed).toBe(true);
  });
});

describe('記録: 合格でベルト +1、不合格で変化なし、訓練とは別のテーブル', () => {
  function ready(): SaveData {
    const d = defaultSaveData(at(2026, 9, 1));
    for (const g of GAME_IDS) d.games[g].trainingDays = days(1, 2, 3);
    d.games['double-hit'].state = { T: 120, stage: 1 };
    return d;
  }

  it('始めた時点で「不合格・0 ラウンド」を記録し、前回の日時を進める（途中でやめても残る）', () => {
    const d = ready();
    const now = at(2026, 9, 29);
    beginCert(d, { id: 'c1', gameId: 'double-hit', at: now.toISOString(), tier: 1 });
    expect(d.certs).toEqual([{ id: 'c1', gameId: 'double-hit', at: now.toISOString(), tier: 1, rounds: [], passed: false }]);
    expect(d.games['double-hit'].lastCertAt).toBe(now.toISOString());
    expect(isIncomplete(d.certs[0]!)).toBe(true);
    expect(certStatus(d.games['double-hit'], now).available).toBe(false);
    expect(d.games['double-hit'].belt).toBe(0);
  });

  it('合格でベルト +1。訓練のラウンド・訓練日・難度・試行ログは変えない', () => {
    const d = ready();
    const before = structuredClone({ rounds: d.rounds, trials: d.trials, games: d.games });
    beginCert(d, { id: 'c1', gameId: 'double-hit', at: at(2026, 9, 29).toISOString(), tier: 1 });
    addCertRound(d, 'c1', stats(24, 20));
    addCertRound(d, 'c1', stats(24, 22));
    finishCert(d, 'c1', true);
    expect(d.games['double-hit'].belt).toBe(1);
    expect(d.certs[0]!.rounds).toEqual([
      { trials: 24, correct: 20 },
      { trials: 24, correct: 22 },
    ]);
    expect(d.certs[0]!.passed).toBe(true);
    expect(isIncomplete(d.certs[0]!)).toBe(false);
    expect(d.rounds).toEqual(before.rounds);
    expect(d.trials).toEqual(before.trials);
    expect(d.games['double-hit'].trainingDays).toEqual(before.games['double-hit'].trainingDays);
    expect(d.games['double-hit'].state).toEqual(before.games['double-hit'].state);
  });

  it('不合格ではベルトは変わらない。合格してもベルトが下がることは無い', () => {
    const d = ready();
    d.games['combo-recall'].belt = 4;
    beginCert(d, { id: 'x', gameId: 'combo-recall', at: at(2026, 9, 29).toISOString(), tier: 5 });
    finishCert(d, 'x', false);
    expect(d.games['combo-recall'].belt).toBe(4);
    beginCert(d, { id: 'y', gameId: 'combo-recall', at: at(2026, 10, 6).toISOString(), tier: 2 });
    finishCert(d, 'y', true);
    expect(d.games['combo-recall'].belt).toBe(4);
  });
});

describe('実行: 固定難度・未訓練の刺激セット・2 ラウンド（適応しない）', () => {
  it('adapt / adaptTrial / power / ウォームアップを呼ばず、2 ラウンドとも certParams(tier) の難度で行う', async () => {
    const base = fakeGame({ trials: 5 });
    const { game, calls } = spy({ ...base, createWarmup: base.createRound });
    let between = 0;
    const res = await runCert(
      { game, tier: 4, seedFor: (n) => n },
      {
        runRound: (req) => runRoundHeadless(game, req.trials, req.params, req.options, req.adaptive, { surface: nullSurface }),
        between: async () => void (between += 1),
      },
    );
    expect(res.rounds).toHaveLength(CERT_ROUNDS);
    expect(between).toBe(1);
    expect(calls.adapt).toBe(0);
    expect(calls.adaptTrial).toBe(0);
    expect(calls.power).toBe(0);
    expect(calls.warmup).toBe(0);
    const fixed = base.certParams(4);
    expect(calls.rounds.map((r) => r.params)).toEqual([fixed, fixed]);
    expect(calls.rounds.map((r) => r.opts)).toEqual([
      { untrained: true, surface: 0, roundNo: 1, kind: 'round' },
      { untrained: true, surface: 0, roundNo: 2, kind: 'round' },
    ]);
    expect(calls.phaseParams.every((p) => p.level === fixed.level && p.stimMs === fixed.stimMs)).toBe(true);
    for (const r of res.rounds) {
      expect(r.paramsStart).toEqual(fixed);
      expect(r.paramsPlayed).toEqual(fixed);
      expect(r.results.every((t) => t.params.stimMs === fixed.stimMs)).toBe(true);
    }
    // 刺激の描画にも未訓練セットの印が渡る
    expect(calls.renderUntrained.length).toBeGreaterThan(0);
    expect(calls.renderUntrained.every(Boolean)).toBe(true);
  });

  it('全問正解なら合格、全問誤りなら不合格、片方のラウンドだけ落としても不合格', async () => {
    const game = fakeGame({ trials: 6 });
    expect((await certHeadless(game, 1, { plan: allCorrect })).verdict).toEqual({ roundPassed: [true, true], passed: true });
    expect((await certHeadless(game, 1, { plan: allWrong })).verdict.passed).toBe(false);
    let roundsDone = 0;
    const oneBad = await certHeadless(game, 1, {
      plan: (c) => (roundsDone >= 1 ? allWrong!(c) : allCorrect!(c)),
      onRound: () => void (roundsDone += 1),
    });
    expect(oneBad.verdict).toEqual({ roundPassed: [true, false], passed: false });
  });
});

describe('審査のラウンド数は訓練の試合のラウンド数と別', () => {
  // ティア 1 の試行数: ダブルヒット 24、コンボ・リコール 20 + n（n = 1）、スタンスチェンジ 16（仕様書 v1.3 で 30 から半減）
  const TIER1_TRIALS: Record<(typeof GAME_IDS)[number], number> = { 'double-hit': 24, 'combo-recall': 21, 'stance-change': 16 };

  it.each(GAME_IDS)('%s: 訓練は 1 試合 1 ラウンド（仕様書 v1.2）でも、審査は CERT_ROUNDS = 2 ラウンドでラウンド間が 1 回', async (id) => {
    const base = GAMES[id];
    expect(base.roundsPerMatch).toBe(1);
    expect(base.extraRounds ?? 0).toBe(0);
    expect(CERT_ROUNDS).toBe(2);
    const { game, calls } = spy(base);
    let between = 0;
    const res = await certHeadless(game, 1, { plan: allCorrect, surface: nullSurface, between: () => void (between += 1) });
    expect(res.rounds).toHaveLength(CERT_ROUNDS);
    expect(res.rounds.map((r) => r.trials)).toEqual([TIER1_TRIALS[id], TIER1_TRIALS[id]]);
    expect(between).toBe(1);
    expect(calls.warmup).toBe(0);
    expect(res.verdict).toEqual({ roundPassed: [true, true], passed: true });
    // 1 ラウンドだけでは合格にならない（2 ラウンドとも必要）
    const n = TIER1_TRIALS[id];
    expect(judgeCert(base, 1, [{ trials: n, correct: n, accuracy: 1, errors: {} }]).passed).toBe(false);
  });
});

describe.each(GAME_IDS)('登録ゲームの認定戦: %s', (id) => {
  const base = GAMES[id];

  it.each([1, 5, 9])('ティア %i: 難度は固定のまま 2 ラウンド、試行数は訓練と同じ、全問正解で合格', async (tier) => {
    const { game, calls } = spy(base);
    const res = await certHeadless(game, tier, { plan: allCorrect, surface: nullSurface });
    const fixed = certParamsOf(base, tier);
    expect(res.rounds).toHaveLength(2);
    expect(calls.adapt + calls.adaptTrial + calls.power + calls.warmup).toBe(0);
    for (const r of res.rounds) {
      expect(r.paramsPlayed).toEqual(fixed);
      for (const t of r.results) expect(t.params).toEqual(fixed);
    }
    // 試行数は訓練と同じ（同じ難度で訓練用に作った試行列と同じ本数）
    const trained = base.createRound(fixed, mulberry32(1), { untrained: false, surface: 0, roundNo: 1, kind: 'round' });
    for (const r of calls.rounds) expect(r.trials).toBe(trained.length);
    expect(calls.rounds.every((r) => r.opts.untrained)).toBe(true);
    expect(calls.renderUntrained.every(Boolean)).toBe(true);
    expect(res.verdict.passed).toBe(true);
  });
});

describe('ルールの一言（roundIntro）', () => {
  it('認定戦では固定難度と untrained: true を渡す（roundIntro が無いゲームは何も出さない）', () => {
    const base = fakeGame();
    const calls: unknown[] = [];
    const game = {
      ...base,
      roundIntro: (p: FakeParams, info: { kind: string; roundNo: number; untrained?: boolean }) => {
        calls.push({ p: { ...p }, info: { ...info } });
        return 'rule';
      },
    };
    expect(certRoundIntro(game, 3, 2)).toBe('rule');
    expect(calls).toEqual([{ p: base.certParams(3), info: { kind: 'round', roundNo: 2, untrained: true } }]);
    expect(certRoundIntro(base, 3, 1)).toBeUndefined();
  });

  it.each(GAME_IDS)('%s: untrained: true を渡しても壊れない', (id) => {
    const game = GAMES[id];
    for (const tier of [1, 5, 9]) {
      const t = certRoundIntro(game, tier, 1);
      if (game.roundIntro) expect(typeof t === 'string' && t.length > 0, `tier ${tier}`).toBe(true);
    }
  });

  it('スタンスチェンジは認定戦では未訓練セットの呼び名で説明する', () => {
    const game = GAMES['stance-change'];
    for (const tier of [1, 6]) {
      const p = game.certParams(tier);
      const trained = game.roundIntro?.(p, { kind: 'round', roundNo: 1 });
      const untrained = game.roundIntro?.(p, { kind: 'round', roundNo: 1, untrained: true });
      expect(untrained, `tier ${tier}`).toBeTruthy();
      expect(untrained, `tier ${tier}`).not.toBe(trained);
    }
  });
});

/** 描画の呼び出しを順に記録する Canvas の代用品（未訓練セットが見た目で区別できるかの確認用） */
function recordingContext(): { ctx: CanvasRenderingContext2D; log: string[] } {
  const log: string[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop !== 'string') return undefined;
      if (prop === 'measureText') return () => ({ width: 10, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 });
      if (prop.startsWith('create')) return () => ({ addColorStop() {} });
      return (...args: unknown[]) => {
        log.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(1) : String(a))).join(',')})`);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push(`${String(prop)}=${String(value)}`);
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

function stimulusSignature(game: GameModule<Params, unknown>, untrained: boolean): string {
  const params = game.certParams(3);
  const opts: RoundOptions = { untrained, surface: 0, roundNo: 1, kind: 'round' };
  const trials = game.createRound(params, mulberry32(11), opts).slice(0, 4);
  const { ctx, log } = recordingContext();
  for (const t of trials) {
    for (const ph of game.phases(t, params)) {
      game.renderStimulus(ctx, t, ph.name, 0, { size: 300, colorSafe: false, untrained, surface: 0, selection: {} });
    }
  }
  return log.join(';');
}

describe('未訓練の刺激セット（受け入れ基準 6「訓練とは別の刺激セット」）', () => {
  // フェーズ1のスタブの間は it.todo にしていたが、3 本とも本実装で未訓練セットを持つので常に確かめる
  it.each(GAME_IDS)('%s: 認定戦の刺激は訓練と見た目が違う（同じ試行列・同じ難度でも描画が変わる）', (id) => {
    const game = GAMES[id] as GameModule<Params, unknown>;
    expect(stimulusSignature(game, true)).not.toBe(stimulusSignature(game, false));
  });
});
