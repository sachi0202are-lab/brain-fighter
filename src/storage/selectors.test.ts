import { describe, expect, it } from 'vitest';
import { DEFAULT_RECENT_ACCURACY, enemyHp, pCpu } from '../skin/hp';
import type { RoundRecord, SaveData } from './schema';
import {
  beltHistory,
  bestPower,
  dailyGameSeries,
  dailyTotalSeries,
  latestPower,
  matchCount,
  recentAccuracies,
  roundAccuracySeries,
  totalBelt,
  totalPowerNow,
} from './selectors';
import { defaultSaveData } from './storage';

let seq = 0;
function r(gameId: RoundRecord['gameId'], local: [number, number, number, number], power: number, extra: Partial<RoundRecord> = {}): RoundRecord {
  const [mo, d, h, mi] = local;
  return {
    id: `r${seq++}`,
    gameId,
    startedAt: new Date(2026, mo - 1, d, h, mi).toISOString(),
    fx: 'light',
    paramsStart: {},
    paramsEnd: {},
    trials: 20,
    correct: 16,
    errors: {},
    power,
    ...extra,
  };
}

function data(rounds: RoundRecord[]): SaveData {
  const d = defaultSaveData();
  d.rounds = rounds;
  return d;
}

describe('戦闘力の集計', () => {
  it('最新・合計・自己ベスト（ウォームアップは数えない）', () => {
    const d = data([
      r('double-hit', [9, 28, 9, 0], 100),
      r('double-hit', [9, 28, 9, 5], 150),
      r('double-hit', [9, 29, 9, 0], 120),
      r('combo-recall', [9, 29, 9, 10], 300),
      r('stance-change', [9, 29, 9, 20], 999, { kind: 'warmup' }),
    ]);
    expect(latestPower(d, 'double-hit')).toBe(120);
    expect(latestPower(d, 'stance-change')).toBe(0);
    expect(totalPowerNow(d)).toBe(420);
    expect(bestPower(d, 'double-hit')).toBe(150);
  });

  it('総合戦闘力の日別推移はその日の最大値', () => {
    const d = data([
      r('double-hit', [9, 28, 9, 0], 100),
      r('combo-recall', [9, 28, 9, 10], 200), // 9/28 最大 300
      r('double-hit', [9, 29, 9, 0], 50), // 9/29: 250
      r('double-hit', [9, 29, 20, 0], 180), // 9/29: 380
      r('combo-recall', [9, 29, 20, 10], 100), // 9/29: 280
    ]);
    expect(dailyTotalSeries(d)).toEqual([
      { date: '2026-09-28', value: 300 },
      { date: '2026-09-29', value: 380 },
    ]);
    expect(dailyGameSeries(d, 'double-hit')).toEqual([
      { date: '2026-09-28', value: 100 },
      { date: '2026-09-29', value: 180 },
    ]);
  });

  it('直近の正答率・試合数・正答率の系列', () => {
    const d = data([
      r('double-hit', [9, 28, 9, 0], 1, { correct: 10, matchId: 'a' }),
      r('double-hit', [9, 28, 9, 1], 1, { correct: 12, matchId: 'a' }),
      r('double-hit', [9, 28, 9, 2], 1, { correct: 14, matchId: 'a' }),
      r('double-hit', [9, 29, 9, 0], 1, { correct: 18, matchId: 'b' }),
      r('combo-recall', [9, 29, 9, 0], 1, { matchId: 'c' }),
    ]);
    expect(recentAccuracies(d, 'double-hit')).toEqual([0.6, 0.7, 0.9]);
    expect(matchCount(d, 'double-hit')).toBe(2);
    expect(roundAccuracySeries(d)).toHaveLength(5);
  });

  it('1 試合 1 ラウンド（仕様書 v1.2）では、敵 HP の「直近 3 ラウンド」= そのゲームの直近 3 試合（日をまたぐ）', () => {
    // ダブルヒット（24 試行）を 1 日 1 試合。間にほかのゲームと v1.0 のウォームアップの記録が混ざる
    const dh = (day: number, correct: number): RoundRecord =>
      r('double-hit', [9, day, 20, 0], 1, { trials: 24, correct, matchId: `m${day}`, roundNo: 1 });
    const hpAfter = (rounds: RoundRecord[]): number => enemyHp(24, recentAccuracies(data(rounds), 'double-hit'));
    // 初回（記録なし）は平均正答率 0.80 と仮定 → p_cpu = 0.75 → 敵 HP 18（24 試行の 75%）
    expect(DEFAULT_RECENT_ACCURACY).toBe(0.8);
    expect(recentAccuracies(data([]), 'double-hit')).toEqual([]);
    expect(pCpu([])).toBeCloseTo(0.75, 10);
    expect(hpAfter([])).toBe(18);
    // 2 試合目は 1 試合目だけ、3 試合目は 2 試合ぶんの平均（既定値では埋めない）
    const m1 = dh(20, 24); // 100%
    const m2 = dh(21, 18); // 75%
    const others = [
      r('combo-recall', [9, 21, 20, 5], 1, { trials: 21, correct: 5, matchId: 'c21', roundNo: 1 }),
      r('stance-change', [9, 21, 20, 10], 1, { trials: 12, correct: 0, kind: 'warmup' }),
    ];
    expect(recentAccuracies(data([m1]), 'double-hit')).toEqual([1]);
    expect(hpAfter([m1])).toBe(21); // p_cpu = min(1 − 0.05, 0.85) = 0.85 → ceil(20.4)
    expect(recentAccuracies(data([m1, ...others, m2]), 'double-hit')).toEqual([1, 0.75]);
    expect(hpAfter([m1, ...others, m2])).toBe(20); // 平均 0.875 → p_cpu 0.825 → ceil(19.8)
    // 4 試合目以降は直近 3 試合だけ（1 試合目は外れる）
    const m3 = dh(22, 15);
    const m4 = dh(23, 21);
    const all = [m4, m1, ...others, m3, m2]; // 保存の順番によらず時刻順
    expect(recentAccuracies(data(all), 'double-hit')).toEqual([0.75, 0.625, 0.875]);
    expect(matchCount(data(all), 'double-hit')).toBe(4);
  });
});

describe('ベルト', () => {
  it('認定戦の合格で上がり、不合格では下がらない。総合ベルトは3本の最低値', () => {
    const d = defaultSaveData();
    d.certs = [
      { id: 'a', gameId: 'double-hit', at: new Date(2026, 8, 1).toISOString(), tier: 1, rounds: [], passed: true },
      { id: 'b', gameId: 'double-hit', at: new Date(2026, 8, 8).toISOString(), tier: 2, rounds: [], passed: false },
      { id: 'c', gameId: 'double-hit', at: new Date(2026, 8, 15).toISOString(), tier: 2, rounds: [], passed: true },
    ];
    expect(beltHistory(d, 'double-hit')).toEqual([
      { date: '2026-09-01', belt: 1 },
      { date: '2026-09-08', belt: 1 },
      { date: '2026-09-15', belt: 2 },
    ]);
    d.games['double-hit'].belt = 2;
    d.games['combo-recall'].belt = 1;
    d.games['stance-change'].belt = 3;
    expect(totalBelt(d)).toBe(1);
  });
});
