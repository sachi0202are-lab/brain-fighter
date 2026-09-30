/**
 * ダブルヒットの難度・適応・認定戦・戦闘力（仕様書 6.1、受け入れ基準 3・4）。
 */
import { describe, expect, it } from 'vitest';
import { doubleHitPower } from '../../engine/power';
import { mulberry32 } from '../../engine/rng';
import { equilibriumAccuracy } from '../../engine/staircase';
import { game } from './index';
import {
  CERT_TIERS,
  MAX_STAGE,
  STAGES,
  T_MAX,
  T_MIN,
  T_STAIRCASE,
  afterRound,
  afterTrial,
  atFloor,
  certDhParams,
  paramsAt,
  presentedT,
  restoreDhParams,
  shouldStageUp,
  stageForDistractors,
  tBand,
  type DhParams,
} from './params';

const F60 = 1000 / 60;
const F120 = 1000 / 120;

describe('難度パラメータとステージ（仕様書 6.1）', () => {
  it('ステージ 0〜4 の妨害数・偏心度・構えの種類数', () => {
    expect(STAGES).toEqual([
      { distractors: 0, eccPct: 35, stances: 2 },
      { distractors: 6, eccPct: 35, stances: 2 },
      { distractors: 12, eccPct: 35, stances: 2 },
      { distractors: 24, eccPct: 45, stances: 2 },
      { distractors: 48, eccPct: 45, stances: 3 },
    ]);
    expect(MAX_STAGE).toBe(4);
  });

  it('初期値は T = 300 ms・ステージ 0', () => {
    expect(game.initialParams).toEqual({ T: 300, stage: 0, distractors: 0, eccPct: 35, stances: 2 });
  });

  it('保存値の T と stage から復元し、残りはラダーから作り直す', () => {
    expect(restoreDhParams({ T: 120, stage: 3 })).toEqual({ T: 120, stage: 3, distractors: 24, eccPct: 45, stances: 2 });
    // 食い違った保存値（手で書き換えた等）はラダーに合わせる
    expect(restoreDhParams({ T: 80, stage: 1, distractors: 48, eccPct: 45, stances: 3 })).toEqual(paramsAt(1, 80));
    // フェーズ1のスタブの保存形式 { T, stage } も読める
    expect(restoreDhParams({ T: 250, stage: 0 })).toEqual(paramsAt(0, 250));
  });

  it('壊れた保存値は範囲に収める', () => {
    expect(restoreDhParams({ T: 5, stage: 9 })).toEqual(paramsAt(4, 33));
    expect(restoreDhParams({ T: 9999, stage: -2 })).toEqual(paramsAt(0, 500));
    expect(restoreDhParams({ T: Number.NaN, stage: 1.6 })).toEqual(paramsAt(2, 300));
    expect(restoreDhParams({})).toEqual(game.initialParams);
  });
});

describe('試行単位の重み付き階段法（提示時間 T）', () => {
  it('正答で T × 0.93、誤答で T × 1.25。T 以外（ステージ等）は動かさない', () => {
    const p = paramsAt(2, 300);
    expect(afterTrial(p, true)).toEqual({ ...p, T: 279 });
    expect(afterTrial(p, false).T).toBeCloseTo(375, 10);
    expect(game.adaptTrial?.(p, true, { correct: true })).toEqual(afterTrial(p, true));
    expect(game.adaptTrial?.(p, false, { correct: false, kind: 'dir' })).toEqual(afterTrial(p, false));
  });

  it('範囲は 33〜500 ms', () => {
    let p = paramsAt(0, 300);
    for (let k = 0; k < 100; k++) p = afterTrial(p, true);
    expect(p.T).toBe(T_MIN);
    for (let k = 0; k < 100; k++) p = afterTrial(p, false);
    expect(p.T).toBe(T_MAX);
  });

  it('ランダムな正誤の系列でも T は常に 33〜500 ms', () => {
    const r = mulberry32(3);
    let p = paramsAt(0, 300);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < 20000; k++) {
      p = afterTrial(p, r.chance(0.3 + 0.6 * r.next()));
      lo = Math.min(lo, p.T);
      hi = Math.max(hi, p.T);
    }
    expect(lo).toBeGreaterThanOrEqual(T_MIN);
    expect(hi).toBeLessThanOrEqual(T_MAX);
  });

  it('収束する正答率は約 75%（0.93 / 1.25）', () => {
    expect(equilibriumAccuracy(T_STAIRCASE)).toBeCloseTo(0.7546, 3);
  });

  it('正答 75%・誤答 25%（正正正誤）の疑似プレイヤーで T が安定する（受け入れ基準 3）', () => {
    for (const start of [60, 150, 300, 450]) {
      let p = paramsAt(0, start);
      const seen: number[] = [];
      // 3 試合分（1 試合 = 1 ラウンド 24 試行）
      for (let k = 0; k < 72; k++) {
        p = afterTrial(p, k % 4 !== 3);
        seen.push(p.T);
      }
      // 試合の後も開始値の ±20% 以内、途中も ±25% 以内で 33〜500 ms の内側
      expect(p.T / start).toBeGreaterThan(0.8);
      expect(p.T / start).toBeLessThan(1.2);
      expect(Math.min(...seen) / start).toBeGreaterThan(0.75);
      expect(Math.max(...seen) / start).toBeLessThan(1.25);
      expect(Math.min(...seen)).toBeGreaterThanOrEqual(T_MIN);
      expect(Math.max(...seen)).toBeLessThanOrEqual(T_MAX);
    }
    // 4 試行ごとの変化は ×(0.93³ × 1.25) ≒ ×1.005（log T の変化は 1 試行あたり +0.0014 と、ほぼ 0）
    const perTrial = (3 * Math.log(0.93) + Math.log(1.25)) / 4;
    expect(Math.abs(perTrial)).toBeLessThan(0.002);
  });

  it('T に関係なく 75% で正答する疑似プレイヤーでは、ラウンドの前後で T が平均的に変わらない', () => {
    // log T の期待変化 = 0.75·ln 0.93 + 0.25·ln 1.25 ≒ +0.0014 / 試行（ほぼ 0）
    const r = mulberry32(75);
    const ratios: number[] = [];
    for (let round = 0; round < 3000; round++) {
      let p = paramsAt(0, 150);
      for (let k = 0; k < 24; k++) p = afterTrial(p, r.chance(0.75));
      ratios.push(Math.log(p.T / 150));
    }
    const meanLog = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    expect(Math.abs(meanLog)).toBeLessThan(0.05);
  }, 30_000);

  it('心理測定関数を持つ疑似プレイヤー（提示値で答える）では、正答率 約 75% の T に収束し、33〜500 ms に収まる', () => {
    // 構え2択×方向8択の当て推量 1/16、Weibull（しきい値 alpha = 120 ms、傾き 2）。p(T*) = 0.7546 → T* ≒ 139 ms
    const guess = 1 / 16;
    const pCorrect = (T: number): number => guess + (1 - guess) * (1 - Math.exp(-((T / 120) ** 2)));
    for (const [seed, start] of [
      [2026, 300],
      [7, 40],
      [11, 500],
    ] as const) {
      const r = mulberry32(seed);
      let p = paramsAt(0, start);
      const tail: { t: number; c: boolean }[] = [];
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < 6000; k++) {
        const shown = presentedT(p.T, F60);
        const c = r.chance(pCorrect(shown));
        if (k >= 2000) tail.push({ t: shown, c });
        p = afterTrial(p, c);
        lo = Math.min(lo, p.T);
        hi = Math.max(hi, p.T);
      }
      expect(lo).toBeGreaterThanOrEqual(T_MIN);
      expect(hi).toBeLessThanOrEqual(T_MAX);
      const acc = tail.filter((x) => x.c).length / tail.length;
      const geoMean = Math.exp(tail.reduce((a, x) => a + Math.log(x.t), 0) / tail.length);
      expect(acc).toBeGreaterThan(0.72);
      expect(acc).toBeLessThan(0.79);
      expect(geoMean).toBeGreaterThan(115);
      expect(geoMean).toBeLessThan(165);
    }
  }, 30_000);
});

describe('ステージ昇格（ラウンド末）', () => {
  it('T が下限かつ正答率 80% 以上で次のステージへ。T は 100 ms に戻り、妨害数などはラダーの値になる', () => {
    expect(afterRound(paramsAt(0, 33), 20 / 24, F60)).toEqual({ T: 100, stage: 1, distractors: 6, eccPct: 35, stances: 2 });
    expect(afterRound(paramsAt(2, 33), 1, F60)).toEqual({ T: 100, stage: 3, distractors: 24, eccPct: 45, stances: 2 });
    expect(afterRound(paramsAt(3, 33), 0.8, F60)).toEqual({ T: 100, stage: 4, distractors: 48, eccPct: 45, stances: 3 });
  });

  it('正答率の境界: 80% ちょうどは昇格、80% 未満（24 試行中 19）は維持', () => {
    expect(shouldStageUp(paramsAt(1, 33), 0.8, F60)).toBe(true);
    expect(shouldStageUp(paramsAt(1, 33), 20 / 25, F60)).toBe(true);
    expect(shouldStageUp(paramsAt(1, 33), 19 / 24, F60)).toBe(false);
    expect(afterRound(paramsAt(1, 33), 19 / 24, F60)).toEqual(paramsAt(1, 33));
  });

  it('T が下限に達していなければ、正答率 100% でも昇格しない', () => {
    expect(afterRound(paramsAt(0, 60), 1, F60)).toEqual(paramsAt(0, 60));
    expect(afterRound(paramsAt(1, 300), 1, F60)).toEqual(paramsAt(1, 300));
  });

  it('下限の判定は実際の提示値（フレームに丸めた値）で行う', () => {
    // 60Hz: 33 ms も 41.25 ms（下限で1回誤答した直後）も 2 フレーム = 33.3 ms で提示される
    expect(presentedT(33, F60)).toBeCloseTo(33.333, 3);
    expect(presentedT(41.25, F60)).toBeCloseTo(33.333, 3);
    expect(atFloor(33, F60)).toBe(true);
    expect(atFloor(41.25, F60)).toBe(true);
    expect(atFloor(42, F60)).toBe(false); // 3 フレーム = 50 ms
    // 120Hz: 下限は 4 フレーム = 33.3 ms。41.25 ms は 5 フレームなので下限ではない
    expect(atFloor(37, F120)).toBe(true);
    expect(atFloor(41.25, F120)).toBe(false);
  });

  it('ステージ 4 が最上位。以降は T の伸縮だけ', () => {
    expect(afterRound(paramsAt(4, 33), 1, F60)).toEqual(paramsAt(4, 33));
    expect(shouldStageUp(paramsAt(4, 33), 1, F60)).toBe(false);
  });

  it('ステージは下がらない（正答率が低くても、T が上限でも）', () => {
    for (let s = 0; s <= 4; s++) {
      for (const T of [33, 100, 500]) {
        for (const acc of [0, 0.3, 0.79]) {
          expect(afterRound(paramsAt(s, T), acc, F60).stage).toBe(s);
        }
      }
    }
  });

  it('adapt はラウンドの正答率とフレーム間隔で判定する（反応時間は見ない）', () => {
    const summary = { accuracy: 22 / 24, frameMs: F60 } as Parameters<NonNullable<typeof game.adapt>>[1];
    expect(game.adapt?.(paramsAt(1, 33), summary)).toEqual(paramsAt(2, 100));
    expect(game.adapt?.(paramsAt(1, 60), summary)).toEqual(paramsAt(1, 60));
  });
});

describe('認定戦の固定ティア（仕様書 6.1・第7節）', () => {
  const TABLE: [number, number, number][] = [
    [400, 0, 35],
    [300, 0, 35],
    [220, 6, 35],
    [160, 6, 35],
    [120, 12, 35],
    [90, 12, 45],
    [67, 24, 45],
    [50, 24, 45],
    [33, 48, 45],
  ];

  it('ティア 1〜9 の T / 妨害数 / 偏心度。構えは全ティア 2 種', () => {
    expect(CERT_TIERS.map((c) => [c.T, c.distractors, c.eccPct])).toEqual(TABLE);
    TABLE.forEach(([T, n, e], k) => {
      const p = game.certParams(k + 1);
      expect(p).toMatchObject({ T, distractors: n, eccPct: e, stances: 2 });
      for (const v of Object.values(p)) expect(Number.isFinite(v)).toBe(true);
    });
  });

  it('訓練のラダーに無い組合せも表せる', () => {
    const onLadder = (p: DhParams): boolean =>
      STAGES.some((s) => s.distractors === p.distractors && s.eccPct === p.eccPct && s.stances === p.stances);
    // ティア 6: 妨害 12 個で偏心度 45%、ティア 9: 妨害 48 個で構え 2 種
    expect(onLadder(certDhParams(6))).toBe(false);
    expect(onLadder(certDhParams(9))).toBe(false);
    expect(onLadder(certDhParams(3))).toBe(true);
  });

  it('stage は妨害数が同じ訓練ステージ（敵レベルの表示用）', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => certDhParams(t).stage)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4]);
    expect(stageForDistractors(0)).toBe(0);
    expect(stageForDistractors(13)).toBe(2);
    expect(stageForDistractors(100)).toBe(4);
  });

  it('範囲外のティアは端に寄せる', () => {
    expect(certDhParams(0)).toEqual(certDhParams(1));
    expect(certDhParams(12)).toEqual(certDhParams(9));
    expect(certDhParams(Number.NaN)).toEqual(certDhParams(1));
    expect(certDhParams(4.6)).toEqual(certDhParams(5));
  });

  it('ティアが上がるほど敵レベルは下がらない', () => {
    const levels = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) => game.enemyLevel(certDhParams(t)));
    for (let k = 1; k < levels.length; k++) expect(levels[k]).toBeGreaterThanOrEqual(levels[k - 1] as number);
  });
});

describe('戦闘力（仕様書 6.1 の式・5.1 MUST）', () => {
  const pw = (stage: number, T: number): number => game.power(paramsAt(stage, T), null);

  it('式どおり: stage 0・T 500 → 0、stage 4・T 33 → 1000', () => {
    expect(pw(0, 500)).toBe(0);
    expect(pw(4, 33)).toBe(1000);
    expect(pw(2, 100)).toBe(Math.round(400 + (200 * Math.log(500 / 100)) / Math.log(500 / 33)));
    for (let s = 0; s <= 4; s++) {
      for (const T of [33, 47.5, 100, 222, 500]) expect(pw(s, T)).toBe(doubleHitPower(s, T));
    }
  });

  it('T について単調（短いほど大きい）、ステージについて単調（上のステージは T によらず下のステージ以上）', () => {
    const Ts: number[] = [];
    for (let T = T_MAX; T >= T_MIN; T *= 0.97) Ts.push(T);
    Ts.push(T_MIN);
    for (let s = 0; s <= 4; s++) {
      for (let k = 1; k < Ts.length; k++) expect(pw(s, Ts[k] as number)).toBeGreaterThanOrEqual(pw(s, Ts[k - 1] as number));
      if (s < 4) {
        const worstUpper = pw(s + 1, T_MAX);
        const bestLower = pw(s, T_MIN);
        expect(worstUpper).toBeGreaterThanOrEqual(bestLower);
      }
    }
    expect(pw(0, 33)).toBe(200);
    expect(pw(1, 500)).toBe(200);
  });

  it('戦闘力は到達難度だけで決まる（正答率・誤答の内訳を変えても同じ。反応時間は受け取らない）', () => {
    const p = paramsAt(2, 80);
    const a = game.power(p, { trials: 24, correct: 24, accuracy: 1, errors: {} });
    const b = game.power(p, { trials: 24, correct: 10, accuracy: 10 / 24, errors: { stance: 14 } });
    expect(a).toBe(b);
    expect(a).toBe(game.power(p, null));
  });
});

describe('敵レベル', () => {
  it('stage × 10 + T の区分（1〜10）。1〜50 の整数', () => {
    expect(game.enemyLevel(paramsAt(0, 500))).toBe(1);
    expect(game.enemyLevel(paramsAt(0, 33))).toBe(10);
    expect(game.enemyLevel(paramsAt(4, 33))).toBe(50);
    expect(game.enemyLevel(paramsAt(2, 300))).toBe(20 + tBand(300));
    expect(tBand(500)).toBe(1);
    expect(tBand(33)).toBe(10);
  });

  it('T が短いほど・ステージが上がるほど単調に増える', () => {
    let prev = 0;
    for (let s = 0; s <= 4; s++) {
      for (let T = T_MAX; T >= T_MIN; T *= 0.95) {
        const lv = game.enemyLevel(paramsAt(s, T));
        expect(Number.isInteger(lv)).toBe(true);
        expect(lv).toBeGreaterThanOrEqual(prev);
        prev = lv;
      }
    }
  });
});
