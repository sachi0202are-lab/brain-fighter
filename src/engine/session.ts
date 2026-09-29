/**
 * 1日のセッション構成（仕様書 4.1・7）。すべて純粋関数（現在時刻は引数で受け取る）。
 *
 * - 1セッション = 3ゲーム各1試合。順番は日替わりのローテーション。
 * - 同じ日の2回目は、1回目を終えてから4時間以上あける。1日の上限は2セッション。
 * - 「今週 x / 5 日」（週は月曜始まり）。連続日数（ストリーク）は扱わない。
 * - 認定戦の解放: そのゲームの訓練日数が 3 日以上、かつ前回の認定戦から 7 日以上。
 */
import { GAME_IDS, type GameId, type GameSave, type SessionRecord } from '../storage/schema';
import { dayNumber, daysBetween, localDate, weekStart } from './dates';
import { makeId } from './ids';

export const SESSION_GAP_MS = 4 * 60 * 60 * 1000;
export const MAX_SESSIONS_PER_DAY = 2;
export const WEEK_GOAL_DAYS = 5;
export const CERT_MIN_TRAINING_DAYS = 3;
export const CERT_INTERVAL_DAYS = 7;

/** その日のゲーム順（暦日の通し番号 mod 3 だけ回す） */
export function sessionOrder(date: string, games: readonly GameId[] = GAME_IDS): GameId[] {
  const n = games.length;
  const k = ((dayNumber(date) % n) + n) % n;
  return [...games.slice(k), ...games.slice(0, k)];
}

export function nextGameOf(s: SessionRecord): GameId | null {
  return s.order.find((g) => !s.done.includes(g)) ?? null;
}

export function isSessionFinished(s: SessionRecord): boolean {
  return nextGameOf(s) === null;
}

/** 1日の回数に数えるセッション（1試合以上終えたもの） */
export function sessionCounts(s: SessionRecord): boolean {
  return s.done.length > 0;
}

export type SessionAvailability =
  /** 今日の途中のセッションがある → 続きから */
  | { status: 'resume'; session: SessionRecord; next: GameId }
  /** 新しいセッションを始められる */
  | { status: 'available'; order: GameId[] }
  /** 2回目まで待つ（availableAt 以降に開始可） */
  | { status: 'wait'; availableAt: Date }
  /** 今日は上限に達した */
  | { status: 'limit' };

export function sessionAvailability(sessions: readonly SessionRecord[], now: Date): SessionAvailability {
  const today = localDate(now);
  const todays = sessions.filter((s) => localDate(new Date(s.startedAt)) === today);
  for (let k = todays.length - 1; k >= 0; k--) {
    const s = todays[k] as SessionRecord;
    const next = nextGameOf(s);
    if (next) return { status: 'resume', session: s, next };
  }
  const counted = todays.filter(sessionCounts);
  if (counted.length >= MAX_SESSIONS_PER_DAY) return { status: 'limit' };
  if (counted.length > 0) {
    const lastEnd = Math.max(...counted.map((s) => Date.parse(s.endedAt ?? s.startedAt)));
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
    const availableAt = Math.min(lastEnd + SESSION_GAP_MS, midnight);
    if (now.getTime() < availableAt) return { status: 'wait', availableAt: new Date(availableAt) };
  }
  return { status: 'available', order: sessionOrder(today) };
}

/** 新しいセッションの記録を作る */
export function createSession(now: Date, order?: GameId[]): SessionRecord {
  return {
    id: makeId('s'),
    startedAt: now.toISOString(),
    order: order ?? sessionOrder(localDate(now)),
    done: [],
  };
}

/** 試合を1つ終えたときにセッションを更新した新しい記録を返す */
export function markGameDone(s: SessionRecord, gameId: GameId, now: Date): SessionRecord {
  const done = s.done.includes(gameId) ? s.done : [...s.done, gameId];
  return { ...s, done, endedAt: now.toISOString() };
}

/** 今週（月曜始まり）に訓練した日数 */
export function weekTrainingDays(days: Iterable<string>, now: Date): number {
  const start = weekStart(now);
  const today = localDate(now);
  const set = new Set<string>();
  for (const d of days) if (d >= start && d <= today) set.add(d);
  return set.size;
}

/** 3ゲームの訓練日の和集合 */
export function allTrainingDays(games: Readonly<Record<GameId, GameSave>>): string[] {
  const set = new Set<string>();
  for (const g of GAME_IDS) for (const d of games[g]?.trainingDays ?? []) set.add(d);
  return [...set].sort();
}

export interface CertAvailability {
  available: boolean;
  /** 訓練日数 */
  trainingDays: number;
  /** 訓練日数の条件を満たしているか */
  daysOk: boolean;
  /** 前回から 7 日以上たっているか（未受験なら true） */
  intervalOk: boolean;
  /** 間隔の条件を満たす日（'YYYY-MM-DD'。満たしていれば無し） */
  nextDate?: string;
}

export function certAvailability(game: GameSave, now: Date): CertAvailability {
  const trainingDays = new Set(game.trainingDays).size;
  const daysOk = trainingDays >= CERT_MIN_TRAINING_DAYS;
  let intervalOk = true;
  let nextDate: string | undefined;
  if (game.lastCertAt) {
    const last = new Date(game.lastCertAt);
    const since = daysBetween(localDate(last), localDate(now));
    intervalOk = since >= CERT_INTERVAL_DAYS;
    if (!intervalOk) {
      nextDate = localDate(new Date(last.getFullYear(), last.getMonth(), last.getDate() + CERT_INTERVAL_DAYS));
    }
  }
  const out: CertAvailability = { available: daysOk && intervalOk, trainingDays, daysOk, intervalOk };
  if (nextDate) out.nextDate = nextDate;
  return out;
}
