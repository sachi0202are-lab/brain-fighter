/** 保存データから画面用の値を計算する（純粋関数） */
import { localDate } from '../engine/dates';
import { totalPower } from '../engine/power';
import { GAME_IDS, type GameId, type RoundRecord, type SaveData } from './schema';

const byTime = (a: { startedAt: string }, b: { startedAt: string }): number =>
  Date.parse(a.startedAt) - Date.parse(b.startedAt);

/** 訓練ラウンド（ウォームアップを除く）を時刻順に */
export function trainingRounds(data: SaveData, gameId?: GameId): RoundRecord[] {
  return data.rounds
    .filter((r) => r.kind !== 'warmup' && (gameId === undefined || r.gameId === gameId))
    .sort(byTime);
}

/** そのゲームの現在の戦闘力（最後の訓練ラウンドの値。未実施は 0） */
export function latestPower(data: SaveData, gameId: GameId): number {
  const rs = trainingRounds(data, gameId);
  return rs.length > 0 ? (rs[rs.length - 1] as RoundRecord).power : 0;
}

export function latestPowers(data: SaveData): Record<GameId, number> {
  const out = {} as Record<GameId, number>;
  for (const g of GAME_IDS) out[g] = latestPower(data, g);
  return out;
}

/** 総合戦闘力（3ゲームの合計） */
export function totalPowerNow(data: SaveData): number {
  return totalPower(Object.values(latestPowers(data)));
}

/** そのゲームの自己ベスト（訓練ラウンドの戦闘力の最大。未実施は 0） */
export function bestPower(data: SaveData, gameId: GameId, excludeIds: ReadonlySet<string> = new Set()): number {
  let best = 0;
  for (const r of trainingRounds(data, gameId)) if (!excludeIds.has(r.id) && r.power > best) best = r.power;
  return best;
}

/** 直近 count ラウンドの正答率（古い順） */
export function recentAccuracies(data: SaveData, gameId: GameId, count = 3): number[] {
  return trainingRounds(data, gameId)
    .slice(-count)
    .map((r) => (r.trials > 0 ? r.correct / r.trials : 0));
}

/** そのゲームで終えた試合の数（表層バリエーションの切替に使う） */
export function matchCount(data: SaveData, gameId: GameId): number {
  const ids = new Set<string>();
  let loose = 0;
  for (const r of trainingRounds(data, gameId)) {
    if (r.matchId) ids.add(r.matchId);
    else loose += 1;
  }
  return ids.size + Math.ceil(loose / 3);
}

export interface DailyPoint {
  date: string; // 'YYYY-MM-DD'
  value: number;
}

/** 総合戦闘力の日別推移（その日の最大値） */
export function dailyTotalSeries(data: SaveData): DailyPoint[] {
  const latest: Record<string, number> = {};
  const dayMax = new Map<string, number>();
  for (const r of trainingRounds(data)) {
    latest[r.gameId] = r.power;
    const total = totalPower(Object.values(latest));
    const day = localDate(new Date(r.startedAt));
    dayMax.set(day, Math.max(dayMax.get(day) ?? 0, total));
  }
  return [...dayMax.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

/** ゲーム別の戦闘力の日別推移（その日の最大値） */
export function dailyGameSeries(data: SaveData, gameId: GameId): DailyPoint[] {
  const dayMax = new Map<string, number>();
  for (const r of trainingRounds(data, gameId)) {
    const day = localDate(new Date(r.startedAt));
    dayMax.set(day, Math.max(dayMax.get(day) ?? 0, r.power));
  }
  return [...dayMax.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, value]) => ({ date, value }));
}

export interface BeltPoint {
  date: string;
  belt: number;
}

/** ベルトの推移（認定戦の合格で上がる。ベルトは下がらない） */
export function beltHistory(data: SaveData, gameId: GameId): BeltPoint[] {
  const certs = data.certs.filter((c) => c.gameId === gameId).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const out: BeltPoint[] = [];
  let belt = 0;
  for (const c of certs) {
    if (c.passed) belt = Math.max(belt, c.tier);
    out.push({ date: localDate(new Date(c.at)), belt });
  }
  return out;
}

/** 総合ベルト = 3本の最低値 */
export function totalBelt(data: SaveData): number {
  return Math.min(...GAME_IDS.map((g) => data.games[g].belt));
}

export interface AccuracyPoint {
  at: string;
  gameId: GameId;
  accuracy: number;
}

/** 訓練ラウンドの正答率（目標 75〜85% の確認用） */
export function roundAccuracySeries(data: SaveData): AccuracyPoint[] {
  return trainingRounds(data).map((r) => ({
    at: r.startedAt,
    gameId: r.gameId,
    accuracy: r.trials > 0 ? r.correct / r.trials : 0,
  }));
}
