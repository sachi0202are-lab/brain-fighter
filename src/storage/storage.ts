/**
 * localStorage への保存（キー `brain-fighter.v1`、JSON 1 本）。
 *
 * - 読み書きはすべて try/catch。localStorage が使えない環境（プライベートモード等）でもアプリは動く。
 * - `version` を見て移行関数（MIGRATIONS）を順に通す。
 * - 試行の生ログ（trials）は直近 30 日分だけ残す。容量不足のときはさらに減らして保存をやり直す。
 * - 壊れた JSON は消さずに別キーへ退避してから初期状態で始める。
 */
import {
  FX_PRESETS,
  GAME_IDS,
  type CertRecord,
  type FxPreset,
  type GameId,
  type GameSave,
  type RoundRecord,
  type SaveData,
  type SessionRecord,
  type TrialLog,
} from './schema';

export const STORAGE_KEY = 'brain-fighter.v1';
export const CURRENT_VERSION = 1;
export const TRIAL_RETENTION_DAYS = 30;

/** localStorage と同じ形の最小インターフェース（テストでは Map で差し替える） */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyGameSave(): GameSave {
  return { state: {}, belt: 0, trainingDays: [] };
}

export function defaultSaveData(now: Date = new Date()): SaveData {
  const games = {} as Record<GameId, GameSave>;
  for (const g of GAME_IDS) games[g] = emptyGameSave();
  return {
    version: 1,
    createdAt: now.toISOString(),
    settings: { fx: 'light', sound: true, colorSafe: false },
    games,
    rounds: [],
    certs: [],
    trials: [],
    sessions: [],
  };
}

// ---------------------------------------------------------------------------
// 移行
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** 移行関数: キーの version から1つ新しい version へ変換する。version 2 を作るときにここへ足す */
export const MIGRATIONS: Readonly<Record<number, (d: Json) => Json>> = {};

export class SaveDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaveDataError';
  }
}

/** 任意の JSON を最新版の SaveData にする（移行 → 正規化）。読めなければ SaveDataError */
export function migrate(
  raw: unknown,
  migrations: Readonly<Record<number, (d: Json) => Json>> = MIGRATIONS,
  current: number = CURRENT_VERSION,
): SaveData {
  if (!isObj(raw)) throw new SaveDataError('データの形式が違います');
  let d: Json = raw;
  const v0 = d.version;
  if (typeof v0 !== 'number' || !Number.isInteger(v0)) throw new SaveDataError('version がありません');
  let v: number = v0;
  if (v > current) throw new SaveDataError(`新しい版のデータです（version ${v}）`);
  while (v < current) {
    const fn = migrations[v];
    if (!fn) throw new SaveDataError(`version ${v} からの移行方法がありません`);
    d = fn(d);
    const nv = d.version;
    if (typeof nv !== 'number' || nv <= v) throw new SaveDataError('移行関数が version を進めませんでした');
    v = nv;
  }
  return normalize(d);
}

// ---------------------------------------------------------------------------
// 正規化（欠けた項目を既定値で補い、壊れた要素は捨てる）
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isGameId = (v: unknown): v is GameId => isStr(v) && (GAME_IDS as readonly string[]).includes(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function numRecord(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!isObj(v)) return out;
  for (const [k, x] of Object.entries(v)) if (isNum(x)) out[k] = x;
  return out;
}

function normGame(v: unknown): GameSave {
  const g = emptyGameSave();
  if (!isObj(v)) return g;
  g.state = numRecord(v.state);
  if (isNum(v.belt)) g.belt = Math.min(9, Math.max(0, Math.round(v.belt)));
  if (isStr(v.lastCertAt)) g.lastCertAt = v.lastCertAt;
  if (Array.isArray(v.trainingDays)) {
    g.trainingDays = [...new Set(v.trainingDays.filter((x): x is string => isStr(x) && DATE_RE.test(x)))].sort();
  }
  return g;
}

function normRound(v: unknown): RoundRecord | null {
  if (!isObj(v)) return null;
  if (!isStr(v.id) || !isGameId(v.gameId) || !isStr(v.startedAt)) return null;
  if (!isNum(v.trials) || !isNum(v.correct) || !isNum(v.power)) return null;
  const fx: FxPreset = (FX_PRESETS as readonly unknown[]).includes(v.fx) ? (v.fx as FxPreset) : 'light';
  const r: RoundRecord = {
    id: v.id,
    gameId: v.gameId,
    startedAt: v.startedAt,
    fx,
    paramsStart: numRecord(v.paramsStart),
    paramsEnd: numRecord(v.paramsEnd),
    trials: v.trials,
    correct: v.correct,
    errors: numRecord(v.errors),
    power: v.power,
  };
  if (isNum(v.rtMedianMs)) r.rtMedianMs = v.rtMedianMs;
  if (isStr(v.matchId)) r.matchId = v.matchId;
  if (v.kind === 'warmup') r.kind = 'warmup';
  if (isNum(v.roundNo)) r.roundNo = v.roundNo;
  if (isNum(v.maxCombo)) r.maxCombo = v.maxCombo;
  if (isNum(v.seed)) r.seed = v.seed;
  if (isNum(v.frameMs)) r.frameMs = v.frameMs;
  if (isObj(v.metrics)) r.metrics = numRecord(v.metrics);
  return r;
}

function normCert(v: unknown): CertRecord | null {
  if (!isObj(v)) return null;
  if (!isStr(v.id) || !isGameId(v.gameId) || !isStr(v.at) || !isNum(v.tier) || typeof v.passed !== 'boolean') return null;
  const rounds = Array.isArray(v.rounds)
    ? v.rounds.filter((x): x is Json => isObj(x) && isNum(x.trials) && isNum(x.correct)).map((x) => ({
        trials: x.trials as number,
        correct: x.correct as number,
      }))
    : [];
  return { id: v.id, gameId: v.gameId, at: v.at, tier: v.tier, rounds, passed: v.passed };
}

function normTrial(v: unknown): TrialLog | null {
  if (!isObj(v)) return null;
  if (!isStr(v.roundId) || !isNum(v.i) || !isNum(v.onsetMs) || !isStr(v.stim) || typeof v.correct !== 'boolean') return null;
  const t: TrialLog = { roundId: v.roundId, i: v.i, onsetMs: v.onsetMs, stim: v.stim, correct: v.correct };
  if (isStr(v.resp)) t.resp = v.resp;
  if (isNum(v.rtMs)) t.rtMs = v.rtMs;
  if (isObj(v.plan)) t.plan = numRecord(v.plan);
  if (isNum(v.stimMs)) t.stimMs = v.stimMs;
  return t;
}

function normSession(v: unknown): SessionRecord | null {
  if (!isObj(v)) return null;
  if (!isStr(v.id) || !isStr(v.startedAt) || !Array.isArray(v.order) || !Array.isArray(v.done)) return null;
  const s: SessionRecord = {
    id: v.id,
    startedAt: v.startedAt,
    order: v.order.filter(isGameId),
    done: v.done.filter(isGameId),
  };
  if (isStr(v.endedAt)) s.endedAt = v.endedAt;
  return s;
}

function list<T>(v: unknown, fn: (x: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    const y = fn(x);
    if (y !== null) out.push(y);
  }
  return out;
}

export function normalize(d: Json): SaveData {
  const base = defaultSaveData();
  const s = isObj(d.settings) ? d.settings : {};
  const games = {} as Record<GameId, GameSave>;
  const rawGames = isObj(d.games) ? d.games : {};
  for (const g of GAME_IDS) games[g] = normGame(rawGames[g]);
  return {
    version: 1,
    createdAt: isStr(d.createdAt) ? d.createdAt : base.createdAt,
    settings: {
      fx: (FX_PRESETS as readonly unknown[]).includes(s.fx) ? (s.fx as FxPreset) : base.settings.fx,
      sound: typeof s.sound === 'boolean' ? s.sound : base.settings.sound,
      colorSafe: typeof s.colorSafe === 'boolean' ? s.colorSafe : base.settings.colorSafe,
    },
    games,
    rounds: list(d.rounds, normRound),
    certs: list(d.certs, normCert),
    trials: list(d.trials, normTrial),
    sessions: list(d.sessions, normSession),
  };
}

// ---------------------------------------------------------------------------
// 生ログの間引き
// ---------------------------------------------------------------------------

/** 開始が直近 days 日以内のラウンドの試行ログだけ残す（ラウンドが無い孤児ログも捨てる） */
export function pruneTrials(
  trials: readonly TrialLog[],
  rounds: readonly RoundRecord[],
  now: Date,
  days: number = TRIAL_RETENTION_DAYS,
): TrialLog[] {
  const cutoff = now.getTime() - days * 86_400_000;
  const keep = new Set(rounds.filter((r) => Date.parse(r.startedAt) >= cutoff).map((r) => r.id));
  return trials.filter((t) => keep.has(t.roundId));
}

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

export interface LoadResult {
  data: SaveData;
  /** 保存できる環境か */
  available: boolean;
  /** 読めなかったデータを退避したときの退避先キー */
  backupKey?: string;
  error?: string;
}

function probe(storage: StorageLike): boolean {
  try {
    const k = `${STORAGE_KEY}.__probe`;
    storage.setItem(k, '1');
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export function loadSaveData(storage: StorageLike | null, now: Date = new Date()): LoadResult {
  if (!storage) return { data: defaultSaveData(now), available: false };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (err) {
    return { data: defaultSaveData(now), available: false, error: String(err) };
  }
  if (raw === null) return { data: defaultSaveData(now), available: probe(storage) };
  try {
    return { data: migrate(JSON.parse(raw)), available: true };
  } catch (err) {
    const backupKey = `${STORAGE_KEY}.unreadable-${now.getTime()}`;
    try {
      storage.setItem(backupKey, raw);
    } catch {
      /* 退避できなくても続ける */
    }
    return { data: defaultSaveData(now), available: probe(storage), backupKey, error: String(err) };
  }
}

export interface SaveResult {
  ok: boolean;
  /** 容量不足で試行ログを 30 日より短く間引いたか */
  pruned?: boolean;
  error?: string;
}

/** 保存する。data.trials は保存前に直近 30 日へ間引かれる（容量不足ならさらに短く） */
export function saveSaveData(storage: StorageLike | null, data: SaveData, now: Date = new Date()): SaveResult {
  if (!storage) return { ok: false, error: 'storage unavailable' };
  data.trials = pruneTrials(data.trials ?? [], data.rounds, now);
  let lastErr: unknown = null;
  for (const days of [TRIAL_RETENTION_DAYS, 14, 7, 1, 0]) {
    if (days < TRIAL_RETENTION_DAYS) data.trials = days > 0 ? pruneTrials(data.trials, data.rounds, now, days) : [];
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(data));
      return days < TRIAL_RETENTION_DAYS ? { ok: true, pruned: true } : { ok: true };
    } catch (err) {
      lastErr = err;
    }
  }
  return { ok: false, error: String(lastErr) };
}

/** 全消去（保存データを消す。退避したデータは残す） */
export function clearSaveData(storage: StorageLike | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** ブラウザの localStorage（アクセスだけで例外になる環境があるので try/catch） */
export function browserStorage(): StorageLike | null {
  try {
    const ls = globalThis.localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}
