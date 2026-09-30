/** コンボ・リコールの GameModule（仕様書 6.2・5.1・第7節）のテスト */
import { describe, expect, it, vi } from 'vitest';
import { blockPower } from '../../engine/power';
import { mulberry32 } from '../../engine/rng';
import { dPrime, median } from '../../engine/stats';
import { layoutGroups, restoreParams, type RenderView, type RoundOptions, type RoundSummary, type TrialResult } from '../../engine/types';
import { comboRecallText as text } from '../../i18n/ja/combo-recall';
import { boardStyle, gridCenter, gridSlots, ringSlots, RING_STYLE, SURFACE_COUNT, TRAINING_STYLES } from './board';
import { ATTACK, CERT_MAX_ERRORS, DARK_MS, game, LIT_MS, type CrParams, type CrTrial } from './index';
import { lureCount, TARGETS } from './nback';

// 並行作業で CPU が詰まった環境でも時間切れにしない（どのテストも通常は 1 秒未満）
vi.setConfig({ testTimeout: 60_000 });

const OPTS: RoundOptions = { untrained: false, surface: 0, roundNo: 1, kind: 'round' };
const RING: RoundOptions = { ...OPTS, untrained: true };
const PRESS = { main: ATTACK } as const;

/** 試行列と「押したか」から RoundSummary を組み立てる（ランナーを通さない単体テスト用） */
function summaryOf(
  n: number,
  trials: CrTrial[],
  press: (t: CrTrial, i: number) => boolean,
  rt: (i: number) => number = () => 400,
): RoundSummary<CrParams, CrTrial> {
  const results: TrialResult<CrParams, CrTrial>[] = trials.map((trial, i) => {
    const response = press(trial, i) ? { ...PRESS } : null;
    const judgement = game.judge(trial, response);
    return {
      i,
      trial,
      params: { n },
      stim: game.describeTrial(trial),
      response,
      judgement,
      correct: judgement.correct,
      ...(response ? { rtMs: rt(i) } : {}),
      onsetMs: i * 2500,
      phases: [],
    };
  });
  const correct = results.filter((r) => r.correct).length;
  const errors: Record<string, number> = {};
  for (const r of results) if (!r.correct) errors[r.judgement.kind as string] = (errors[r.judgement.kind as string] ?? 0) + 1;
  return {
    kind: 'round',
    roundNo: 1,
    trials: results.length,
    correct,
    accuracy: correct / results.length,
    errors,
    paramsStart: { n },
    paramsPlayed: { n },
    maxCombo: 0,
    frameMs: 1000 / 60,
    results,
  };
}

/** 見逃し m 個・誤警報 f 個（ルアー以外から）のラウンド */
function withErrors(n: number, misses: number, falseAlarms: number, seed = 1, opts: RoundOptions = OPTS): RoundSummary<CrParams, CrTrial> {
  const trials = game.createRound({ n }, mulberry32(seed), opts);
  const targets = trials.flatMap((t, i) => (t.target ? [i] : []));
  const plain = trials.flatMap((t, i) => (!t.target && !t.lure ? [i] : []));
  const missSet = new Set(targets.slice(0, misses));
  const faSet = new Set(plain.slice(0, falseAlarms));
  return summaryOf(n, trials, (t, i) => (t.target ? !missSet.has(i) : faSet.has(i)));
}

/** 仕様書 5.1・6.2 の式をそのまま書いたもの */
function specPower(n: number, errors: number): number {
  const N = 20 + n;
  const acc = 1 - errors / N;
  const accDown = 1 - 5 / N;
  const accUp = 1 - 2 / N;
  const sub = Math.min(1, Math.max(0, (acc - accDown) / (accUp - accDown)));
  return Math.round((1000 * (n - 1 + sub)) / 9);
}

describe('基本の設定', () => {
  it('初期 n = 1、1試合 1 ラウンド（「もう1ラウンド」は無い。仕様書 v1.2）、表層は複数', () => {
    expect(game.id).toBe('combo-recall');
    expect(game.initialParams).toEqual({ n: 1 });
    expect(game.roundsPerMatch).toBe(1);
    expect(game.extraRounds).toBe(0);
    expect(game.surfaceCount).toBe(SURFACE_COUNT);
    expect(SURFACE_COUNT).toBeGreaterThanOrEqual(2);
  });

  it('保存値から n を戻す（1〜9 の整数にそろえる）', () => {
    expect(restoreParams(game, { n: 4 })).toEqual({ n: 4 });
    expect(restoreParams(game, {})).toEqual({ n: 1 });
    expect(restoreParams(game, undefined)).toEqual({ n: 1 });
    expect(restoreParams(game, { n: 0 })).toEqual({ n: 1 });
    expect(restoreParams(game, { n: 15 })).toEqual({ n: 9 });
    expect(restoreParams(game, { n: 2.7 })).toEqual({ n: 3 });
    expect(restoreParams(game, { n: Number.NaN })).toEqual({ n: 1 });
  });

  it('敵レベル = n', () => {
    for (let n = 1; n <= 9; n++) expect(game.enemyLevel({ n })).toBe(n);
  });
});

describe('試行のフェーズ（点灯 500 ms → 消灯 2,000 ms、ずっと応答可、固定タイミング）', () => {
  it('どの n・どの試行でも同じ 2 フェーズ', () => {
    for (let n = 1; n <= 9; n++) {
      for (const t of game.createRound({ n }, mulberry32(n), OPTS)) {
        expect(game.phases(t, { n })).toEqual([
          { name: 'stimulus', ms: LIT_MS, input: true },
          { name: 'response', ms: DARK_MS, input: true },
        ]);
      }
    }
    expect(LIT_MS).toBe(500);
    expect(DARK_MS).toBe(2000);
  });

  it('応答で打ち切らない（untilResponse を使わない）', () => {
    const t = game.createRound({ n: 2 }, mulberry32(3), OPTS)[0] as CrTrial;
    expect(game.phases(t, { n: 2 }).some((p) => p.untilResponse)).toBe(false);
  });
});

describe('応答レイアウト（「攻撃」1つ、PC はスペース）', () => {
  it('ボタンは攻撃だけ、キーはスペース', () => {
    const layout = game.responseLayout({ n: 3 }, OPTS);
    expect(layout.columns).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.buttons).toHaveLength(1);
    const b = layout.buttons[0]!;
    expect(b.id).toBe(ATTACK);
    expect(b.label).toBe(text.buttons.attack);
    expect(b.keys).toContain(' ');
    expect(b.keys).toContain('Space');
    expect(b.ariaLabel).toContain('3');
    expect(layoutGroups(layout)).toEqual(['main']);
  });
});

describe('判定（見逃し／誤警報）', () => {
  const trials = game.createRound({ n: 4 }, mulberry32(21), OPTS);
  const target = trials.find((t) => t.target)!;
  const lure = trials.find((t) => t.lure)!;
  const plain = trials.find((t) => !t.target && !t.lure)!;

  it('標的で押す = 正答（ヒット）、押さない = 見逃し', () => {
    expect(game.judge(target, PRESS)).toEqual({ correct: true });
    expect(game.judge(target, null)).toEqual({ correct: false, kind: 'miss' });
  });

  it('非標的で押さない = 正答、押す = 誤警報（ルアーでも同じ誤警報。ルアーの分は metrics で別に数える）', () => {
    expect(game.judge(plain, null)).toEqual({ correct: true });
    expect(game.judge(plain, PRESS)).toEqual({ correct: false, kind: 'fa' });
    expect(game.judge(lure, null)).toEqual({ correct: true });
    expect(game.judge(lure, PRESS)).toEqual({ correct: false, kind: 'fa' });
  });

  it('正解の応答は、標的なら「攻撃」、それ以外は押さない（null）', () => {
    for (const t of trials) {
      const exp = game.expectedResponse(t);
      expect(exp).toEqual(t.target ? { main: ATTACK } : null);
      expect(game.judge(t, exp).correct).toBe(true);
    }
  });

  it('試行の説明で標的（*）とルアー（~）と盤の種類が読める', () => {
    expect(game.describeTrial({ pos: 3, target: true, lure: false, ring: false })).toBe('g3*');
    expect(game.describeTrial({ pos: 5, target: false, lure: true, ring: true })).toBe('r5~');
    expect(game.describeTrial({ pos: 0, target: false, lure: false, ring: false })).toBe('g0');
  });
});

describe('適応（ラウンド単位。誤り < 3 → n+1、> 5 → n−1、他は維持、範囲 1〜9）', () => {
  it('誤り 0〜2 → n+1、3〜5 → 維持、6 以上 → n−1', () => {
    const cases: [number, number, number][] = [
      // [誤り（見逃し, 誤警報）→ 次の n]  n = 4 で
      [0, 0, 5],
      [1, 1, 5],
      [2, 0, 5],
      [1, 2, 4],
      [2, 2, 4],
      [3, 2, 4],
      [4, 2, 3],
      [2, 5, 3],
      [6, 6, 3],
    ];
    for (const [m, f, next] of cases) {
      const round = withErrors(4, m, f);
      expect(round.trials - round.correct).toBe(m + f);
      expect(game.adapt!({ n: 4 }, round)).toEqual({ n: next });
    }
  });

  it('見逃しだけ・誤警報だけでも同じ数え方（誤り = 見逃し + 誤警報）', () => {
    expect(game.adapt!({ n: 3 }, withErrors(3, 2, 0))).toEqual({ n: 4 });
    expect(game.adapt!({ n: 3 }, withErrors(3, 0, 2))).toEqual({ n: 4 });
    expect(game.adapt!({ n: 3 }, withErrors(3, 6, 0))).toEqual({ n: 2 });
    expect(game.adapt!({ n: 3 }, withErrors(3, 0, 6))).toEqual({ n: 2 });
  });

  it('範囲は 1〜9', () => {
    expect(game.adapt!({ n: 9 }, withErrors(9, 0, 0))).toEqual({ n: 9 });
    expect(game.adapt!({ n: 1 }, withErrors(1, 6, 4))).toEqual({ n: 1 });
    expect(game.adapt!({ n: 8 }, withErrors(8, 1, 0))).toEqual({ n: 9 });
    expect(game.adapt!({ n: 2 }, withErrors(2, 3, 3))).toEqual({ n: 1 });
  });

  it('認定戦（円周の未訓練セット）のラウンドでは n を変えない', () => {
    expect(game.adapt!({ n: 5 }, withErrors(5, 0, 0, 1, RING))).toEqual({ n: 5 });
    expect(game.adapt!({ n: 5 }, withErrors(5, 5, 4, 1, RING))).toEqual({ n: 5 });
  });

  it('全部押さない → 見逃し 6 で n−1、全部押す → 誤警報だらけで n−1（当て推量で上がらない）', () => {
    const trials = game.createRound({ n: 3 }, mulberry32(4), OPTS);
    const none = summaryOf(3, trials, () => false);
    expect(none.trials - none.correct).toBe(TARGETS);
    expect(game.adapt!({ n: 3 }, none)).toEqual({ n: 2 });
    const all = summaryOf(3, trials, () => true);
    expect(all.trials - all.correct).toBe(trials.length - TARGETS);
    expect(game.adapt!({ n: 3 }, all)).toEqual({ n: 2 });
  });
});

describe('戦闘力（K = 9、L = n、acc = 1 − 誤り/(20+n)、accDown = 1 − 5/(20+n)、accUp = 1 − 2/(20+n)）', () => {
  it('仕様書の式どおり（n = 1〜9、誤り 0〜10）', () => {
    for (let n = 1; n <= 9; n++) {
      for (let e = 0; e <= 10; e++) {
        const stats = { trials: 20 + n, correct: 20 + n - e, accuracy: (20 + n - e) / (20 + n), errors: { miss: e } };
        const N = 20 + n;
        expect(game.power({ n }, stats)).toBe(specPower(n, e));
        expect(game.power({ n }, stats)).toBe(blockPower({ level: n, levels: 9, acc: 1 - e / N, accDown: 1 - 5 / N, accUp: 1 - 2 / N }));
      }
    }
  });

  it('代表値', () => {
    const at = (n: number, e: number): number =>
      game.power({ n }, { trials: 20 + n, correct: 20 + n - e, accuracy: (20 + n - e) / (20 + n), errors: {} });
    expect(at(1, 5)).toBe(0); // 最低
    expect(at(1, 4)).toBe(37); // sub = 1/3 → 1000 × (1/3) / 9
    expect(at(3, 4)).toBe(259);
    expect(at(5, 3)).toBe(519); // sub = 2/3 → 1000 × 4.667 / 9
    expect(at(9, 2)).toBe(1000); // 最高
    expect(at(9, 0)).toBe(1000);
    // レベルの境目で連続（n の上限 = n+1 の下限）
    for (let n = 1; n < 9; n++) expect(at(n, 2)).toBe(at(n + 1, 5));
  });

  it('ラウンドがまだ無いときは sub = 0', () => {
    expect(game.power({ n: 1 }, null)).toBe(0);
    expect(game.power({ n: 4 }, null)).toBe(333);
  });

  it('速さは使わない: 同じ正誤で反応時間だけ違っても、戦闘力も次の n も同じ', () => {
    const trials = game.createRound({ n: 3 }, mulberry32(9), OPTS);
    const press = (t: CrTrial, i: number): boolean => (i % 5 === 4 ? !t.target : t.target);
    const fast = summaryOf(3, trials, press, () => 150);
    const slow = summaryOf(3, trials, press, (i) => 1800 + i);
    expect(game.metrics!(fast, { warmup: null }).rtMedianMs).not.toBe(game.metrics!(slow, { warmup: null }).rtMedianMs);
    expect(game.power({ n: 3 }, fast)).toBe(game.power({ n: 3 }, slow));
    expect(game.adapt!({ n: 3 }, fast)).toEqual(game.adapt!({ n: 3 }, slow));
  });
});

describe('認定戦（n = ティア、円周上の 8 点の未訓練セット）', () => {
  it('ティア 1〜9 → n = ティア（範囲外はそろえる）', () => {
    for (let tier = 1; tier <= 9; tier++) expect(game.certParams(tier)).toEqual({ n: tier });
    expect(game.certParams(0)).toEqual({ n: 1 });
    expect(game.certParams(10)).toEqual({ n: 9 });
  });

  it('未訓練セットの試行も判定の約束は同じ（20 + n 試行、標的 6、ルアー 10〜15%）', () => {
    for (let tier = 1; tier <= 9; tier++) {
      const p = game.certParams(tier);
      const trials = game.createRound(p, mulberry32(tier), RING);
      expect(trials).toHaveLength(20 + tier);
      expect(trials.every((t) => t.ring)).toBe(true);
      expect(trials.filter((t) => t.target)).toHaveLength(TARGETS);
      expect(trials.filter((t) => t.lure).length).toBe(tier >= 3 ? lureCount(tier) : trials.filter((t) => t.lure).length);
      expect(game.describeTrial(trials[0]!).startsWith('r')).toBe(true);
      // 同じシードなら訓練と同じ位置の並び（見た目と位置の意味だけが違う）
      const trained = game.createRound(p, mulberry32(tier), OPTS);
      expect(trials.map((t) => [t.pos, t.target, t.lure])).toEqual(trained.map((t) => [t.pos, t.target, t.lure]));
    }
  });

  it('1ラウンドの合格は誤り 4 以下（n によらない）', () => {
    const stats = (trials: number, errors: number) => ({ trials, correct: trials - errors, accuracy: (trials - errors) / trials, errors: {} });
    expect(CERT_MAX_ERRORS).toBe(4);
    for (let n = 1; n <= 9; n++) {
      expect(game.certRoundPassed!(stats(20 + n, 4), n)).toBe(true);
      expect(game.certRoundPassed!(stats(20 + n, 5), n)).toBe(false);
    }
  });
});

describe('記録（metrics: n、誤りの内訳、ルアーへの誤警報、d′、反応時間の中央値）', () => {
  it('内訳の数と d′（stats.ts の log-linear 補正）', () => {
    const trials = game.createRound({ n: 4 }, mulberry32(33), OPTS);
    const targetIdx = trials.flatMap((t, i) => (t.target ? [i] : []));
    const lureIdx = trials.flatMap((t, i) => (t.lure ? [i] : []));
    const plainIdx = trials.flatMap((t, i) => (!t.target && !t.lure ? [i] : []));
    // 見逃し 1、ルアーへの誤警報 1、それ以外への誤警報 1
    const miss = new Set([targetIdx[0]]);
    const fa = new Set([lureIdx[0], plainIdx[0]]);
    const rts = new Map(targetIdx.map((i, k) => [i, 300 + 100 * k]));
    const round = summaryOf(4, trials, (t, i) => (t.target ? !miss.has(i) : fa.has(i)), (i) => rts.get(i) ?? 999);
    const m = game.metrics!(round, { warmup: null });
    const crs = trials.length - TARGETS - 2;
    expect(m).toMatchObject({
      n: 4,
      targets: TARGETS,
      lures: lureCount(4),
      hits: TARGETS - 1,
      misses: 1,
      falseAlarms: 2,
      lureFalseAlarms: 1,
      correctRejections: crs,
      errors: 3,
    });
    expect(m.dPrime).toBeCloseTo(Math.round(dPrime(TARGETS - 1, 1, 2, crs) * 100) / 100, 10);
    // ヒットの反応時間だけの中央値（誤警報の 999 は入らない）
    const hitRts = targetIdx.slice(1).map((i) => rts.get(i) as number);
    expect(m.rtMedianMs).toBe(Math.round(median(hitRts) as number));
    // 誤答の内訳（RoundRecord.errors）は見逃しと誤警報
    expect(round.errors).toEqual({ miss: 1, fa: 2 });
    for (const v of Object.values(m)) expect(Number.isFinite(v)).toBe(true);
  });

  it('d′ の手計算の例: ヒット 5・見逃し 1・誤警報 2・正しい見送り 13 → 約 1.80', () => {
    // HR = 5.5/7、FAR = 2.5/16、d′ = z(0.7857) − z(0.1563) ≈ 0.792 + 1.010
    expect(dPrime(5, 1, 2, 13)).toBeCloseTo(1.8, 2);
  });

  it('全問正解でも d′ は有限、ヒットが無ければ反応時間の中央値は出さない', () => {
    const trials = game.createRound({ n: 2 }, mulberry32(8), OPTS);
    const perfect = game.metrics!(summaryOf(2, trials, (t) => t.target), { warmup: null });
    expect(Number.isFinite(perfect.dPrime)).toBe(true);
    expect(perfect.dPrime).toBeGreaterThan(3);
    const none = game.metrics!(summaryOf(2, trials, () => false), { warmup: null });
    expect(none.hits).toBe(0);
    expect(none.rtMedianMs).toBeUndefined();
  });
});

describe('ラウンドの一言とルールの一言', () => {
  it('roundIntro は毎ラウンド n を数字で出す', () => {
    for (let n = 1; n <= 9; n++) {
      const s = game.roundIntro!({ n }, { kind: 'round', roundNo: 2 });
      expect(s).toContain(`${n} 個前`);
      expect(s).toContain('攻撃');
    }
  });

  it('roundTip は誤りの内訳で選ぶ（方略・努力向け）', () => {
    expect(game.roundTip!(withErrors(3, 0, 0))).toBe(text.tip.perfect);
    expect(game.roundTip!(withErrors(3, 1, 1))).toBe(text.tip.fewErrors);
    expect(game.roundTip!(withErrors(3, 3, 1))).toBe(text.tip.moreMisses);
    expect(game.roundTip!(withErrors(3, 1, 3))).toBe(text.tip.moreFalseAlarms);
    expect(game.roundTip!(withErrors(3, 2, 2))).toBe(text.tip.balanced);
    // 誤り 3 以上で、ルアーへの誤警報が誤警報の半分以上（2 回以上）
    const trials = game.createRound({ n: 5 }, mulberry32(12), OPTS);
    const lures = trials.flatMap((t, i) => (t.lure ? [i] : []));
    const firstTarget = trials.findIndex((t) => t.target);
    const lureRound = summaryOf(5, trials, (t, i) => (t.target ? i !== firstTarget : lures.slice(0, 2).includes(i)));
    expect(lureRound.trials - lureRound.correct).toBe(3);
    expect(game.roundTip!(lureRound)).toBe(text.tip.lure);
  });
});

// ---------------------------------------------------------------------------
// 描画（Canvas の呼び出しを記録して調べる）

interface Recorded {
  ctx: CanvasRenderingContext2D;
  ops: string[];
  /** fill / fillRect を呼んだときの fillStyle */
  fills: string[];
}

function recorder(): Recorded {
  const ops: string[] = [];
  const fills: string[] = [];
  const state: Record<string, unknown> = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1 };
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        if (prop in state) return state[prop];
        return (...args: unknown[]) => {
          ops.push(`${prop}(${args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')})`);
          if (prop === 'fill' || prop === 'fillRect') fills.push(String(state.fillStyle));
        };
      },
      set(_t, prop, value) {
        state[String(prop)] = value;
        ops.push(`${String(prop)}=${String(value)}`);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, ops, fills };
}

function view(over: Partial<RenderView> = {}): RenderView {
  return { size: 320, colorSafe: false, untrained: false, surface: 0, selection: {}, ...over };
}

function render(trial: CrTrial, phase: 'stimulus' | 'response', t: number, v: RenderView): Recorded {
  const r = recorder();
  game.renderStimulus(r.ctx, trial, phase, t, v);
  return r;
}

describe('描画', () => {
  const trial: CrTrial = { pos: 5, target: false, lure: false, ring: false };

  it('点灯（stimulus）では 1 マスだけ光り、消灯（response）では光らない', () => {
    for (let surface = 0; surface < SURFACE_COUNT; surface++) {
      for (const untrained of [false, true]) {
        const style = boardStyle(surface, untrained);
        for (let pos = 0; pos < 8; pos++) {
          const t = { ...trial, pos };
          const on = render(t, 'stimulus', 0, view({ surface, untrained }));
          // マスの塗り（消灯色か点灯色）は 8 つ、点灯色はその試行の位置の 1 つだけ
          const tiles = on.fills.filter((f) => f === style.tile || f === style.lit);
          expect(tiles).toHaveLength(8);
          expect(tiles.indexOf(style.lit)).toBe(pos);
          expect(tiles.filter((f) => f === style.lit)).toHaveLength(1);
          // 点灯マスには形の印（打撃マーク）も付く
          expect(on.fills).toContain(style.litMark);
          const off = render(t, 'response', 0, view({ surface, untrained }));
          expect(off.fills.filter((f) => f === style.lit)).toHaveLength(0);
          expect(off.fills.filter((f) => f === style.tile)).toHaveLength(8);
        }
      }
    }
  });

  it('時刻 t で描画が変わらない（提示中に動くものが無い）', () => {
    for (const untrained of [false, true]) {
      const v = view({ untrained });
      const a = render(trial, 'stimulus', 0, v).ops;
      expect(render(trial, 'stimulus', 250, v).ops).toEqual(a);
      expect(render(trial, 'stimulus', 499, v).ops).toEqual(a);
      const b = render(trial, 'response', 0, v).ops;
      expect(render(trial, 'response', 1999, v).ops).toEqual(b);
    }
  });

  it('認定戦（untrained）は円周上の 8 点で、訓練の盤と見た目が違う', () => {
    const trained = render(trial, 'stimulus', 0, view());
    const ring = render(trial, 'stimulus', 0, view({ untrained: true }));
    expect(ring.ops).not.toEqual(trained.ops);
    expect(ring.fills[0]).toBe(RING_STYLE.bg);
    expect(trained.fills[0]).toBe(TRAINING_STYLES[0]!.bg);
    // 表層バリエーションに関係なく未訓練セットは同じ
    expect(render(trial, 'stimulus', 0, view({ untrained: true, surface: 2 })).ops).toEqual(ring.ops);
    // 訓練の色と重ならない
    for (const s of TRAINING_STYLES) {
      expect(s.bg).not.toBe(RING_STYLE.bg);
      expect(s.lit).not.toBe(RING_STYLE.lit);
    }
  });

  it('表層バリエーションで背景・マス・敵の見た目が変わる（番号は循環）', () => {
    const sigs = Array.from({ length: SURFACE_COUNT }, (_, s) => render(trial, 'stimulus', 0, view({ surface: s })).ops.join(';'));
    expect(new Set(sigs).size).toBe(SURFACE_COUNT);
    expect(new Set(TRAINING_STYLES.map((s) => s.bg)).size).toBe(SURFACE_COUNT);
    expect(new Set(TRAINING_STYLES.map((s) => s.shape)).size).toBe(SURFACE_COUNT);
    expect(new Set(TRAINING_STYLES.map((s) => s.pose)).size).toBe(SURFACE_COUNT);
    expect(boardStyle(SURFACE_COUNT, false)).toBe(boardStyle(0, false));
    expect(boardStyle(-1, false)).toBe(boardStyle(SURFACE_COUNT - 1, false));
  });

  it('表層バリエーションは時間を変えない（フェーズは surface を受け取らない）', () => {
    const t = game.createRound({ n: 2 }, mulberry32(1), { ...OPTS, surface: 2 })[0]!;
    expect(game.phases(t, { n: 2 })).toEqual(game.phases(game.createRound({ n: 2 }, mulberry32(1), OPTS)[0]!, { n: 2 }));
    expect(game.createRound({ n: 2 }, mulberry32(1), { ...OPTS, surface: 2 })).toEqual(game.createRound({ n: 2 }, mulberry32(1), OPTS));
  });

  it('盤の形: 訓練は 3×3 の外周 8 マス（中央は敵）、認定戦は円周上の 8 点。どれも領域の中で重ならない', () => {
    const size = 300;
    for (const slots of [gridSlots(size), ringSlots(size)]) {
      expect(slots).toHaveLength(8);
      for (const s of slots) {
        expect(s.x - s.r * 1.12).toBeGreaterThanOrEqual(0);
        expect(s.x + s.r * 1.12).toBeLessThanOrEqual(size);
        expect(s.y - s.r * 1.12).toBeGreaterThanOrEqual(0);
        expect(s.y + s.r * 1.12).toBeLessThanOrEqual(size);
      }
      for (let a = 0; a < 8; a++) {
        for (let b = a + 1; b < 8; b++) {
          const A = slots[a]!;
          const B = slots[b]!;
          // ひし形の頂点（中心から r × 1.12）を含めても隣と重ならない
          expect(Math.hypot(A.x - B.x, A.y - B.y)).toBeGreaterThan((A.r + B.r) * 1.12);
        }
      }
    }
    // 訓練の 8 マスは中央のマスを囲む
    const c = gridCenter(size);
    const g = gridSlots(size);
    expect(g.some((s) => Math.abs(s.x - c.x) < 1e-9 && Math.abs(s.y - c.y) < 1e-9)).toBe(false);
    // 円周の点は訓練の方向から 22.5° ずれている（真上・真横・斜め 45° に点が無い）
    for (const s of ringSlots(size)) {
      const deg = (Math.atan2(s.y - size / 2, s.x - size / 2) * 180) / Math.PI;
      const mod = ((deg % 45) + 45) % 45;
      expect(Math.abs(mod - 22.5)).toBeLessThan(1e-6);
    }
  });

  it('色覚配慮モードでも点灯は明るさの差（と形の印）で分かる', () => {
    const lum = (hex: string): number => {
      const v = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * (v[0] as number) + 0.7152 * (v[1] as number) + 0.0722 * (v[2] as number);
    };
    for (const s of [...TRAINING_STYLES, RING_STYLE]) {
      const ratio = (lum(s.lit) + 0.05) / (lum(s.tile) + 0.05);
      expect(ratio).toBeGreaterThan(7);
    }
  });
});
