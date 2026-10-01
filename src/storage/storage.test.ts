import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../test/memory-storage';
import { exportFileName, parseImport, serializeSaveData } from './io';
import type { RoundRecord, SaveData, TrialLog } from './schema';
import {
  CURRENT_VERSION,
  defaultSaveData,
  loadSaveData,
  migrate,
  normalize,
  pruneTrials,
  saveSaveData,
  SaveDataError,
  STORAGE_KEY,
} from './storage';
import { Store } from './store';

const NOW = new Date('2026-09-29T03:00:00.000Z');

function round(id: string, startedAt: string, extra: Partial<RoundRecord> = {}): RoundRecord {
  return {
    id,
    gameId: 'double-hit',
    startedAt,
    fx: 'light',
    paramsStart: { T: 300, stage: 0 },
    paramsEnd: { T: 280, stage: 0 },
    trials: 24,
    correct: 19,
    errors: { dir: 3, stance: 2 },
    rtMedianMs: 612.4,
    power: 123,
    ...extra,
  };
}

function trial(roundId: string, i: number): TrialLog {
  return { roundId, i, onsetMs: 1000 + i * 1500, stim: 'circle/left', resp: 'shape=circle,side=left', rtMs: 450.2, correct: true, plan: { stimulus: 300, response: 3000 }, stimMs: 300.1 };
}

/** すべての項目（拡張も含む）が入ったデータ */
function richData(): SaveData {
  const d = defaultSaveData(new Date('2026-09-01T00:00:00.000Z'));
  d.settings = { fx: 'full', sound: false, colorSafe: true, bgm: true };
  d.games['double-hit'] = { state: { T: 120.5, stage: 1 }, belt: 2, lastCertAt: '2026-09-20T10:00:00.000Z', trainingDays: ['2026-09-27', '2026-09-28'] };
  d.games['combo-recall'].state = { n: 3 };
  d.rounds = [
    round('r1', '2026-09-28T01:00:00.000Z', { matchId: 'm1', roundNo: 1, maxCombo: 7, seed: 42, frameMs: 16.667, metrics: { tMedian: 150 } }),
    round('w1', '2026-09-28T00:59:00.000Z', { matchId: 'm1', roundNo: 0, kind: 'warmup' }),
  ];
  d.certs = [{ id: 'c1', gameId: 'double-hit', at: '2026-09-20T10:00:00.000Z', tier: 2, rounds: [{ trials: 24, correct: 20 }, { trials: 24, correct: 21 }], passed: true }];
  d.trials = [trial('r1', 0), trial('r1', 1)];
  d.sessions = [{ id: 's1', startedAt: '2026-09-28T00:58:00.000Z', endedAt: '2026-09-28T01:10:00.000Z', order: ['double-hit', 'combo-recall', 'stance-change'], done: ['double-hit'] }];
  d.onboardedAt = '2026-09-01T00:01:00.000Z';
  return d;
}

describe('読み込み', () => {
  it('何も無ければ既定値（保存可能）', () => {
    const r = loadSaveData(new MemoryStorage(), NOW);
    expect(r.available).toBe(true);
    expect(r.data.version).toBe(1);
    expect(r.data.settings).toEqual({ fx: 'light', sound: true, colorSafe: false, bgm: false });
    expect(r.data.rounds).toEqual([]);
    expect(Object.keys(r.data.games).sort()).toEqual(['combo-recall', 'double-hit', 'stance-change']);
  });

  it('保存 → 読み込みで同じデータに戻る（ブラウザを閉じて再開）', () => {
    const st = new MemoryStorage();
    const d = richData();
    expect(saveSaveData(st, d, NOW).ok).toBe(true);
    expect(st.map.has(STORAGE_KEY)).toBe(true);
    expect(loadSaveData(st, NOW).data).toEqual(d);
  });

  it('localStorage が使えない環境でも既定値で動く（読めない・書けない・存在しない）', () => {
    const noGet = new MemoryStorage();
    noGet.failGet = true;
    expect(loadSaveData(noGet, NOW).available).toBe(false);
    const noSet = new MemoryStorage();
    noSet.failSet = true;
    const r = loadSaveData(noSet, NOW);
    expect(r.available).toBe(false);
    expect(r.data.rounds).toEqual([]);
    expect(loadSaveData(null, NOW).available).toBe(false);
    expect(saveSaveData(null, r.data, NOW).ok).toBe(false);
    const store = new Store(noSet, () => NOW);
    expect(store.available).toBe(false);
    store.update((d) => d.rounds.push(round('x', NOW.toISOString())));
    expect(store.data.rounds).toHaveLength(1); // メモリ上では続けられる
  });

  it('壊れた JSON は別キーに退避してから既定値で始める', () => {
    const st = new MemoryStorage();
    st.map.set(STORAGE_KEY, '{"version":1, broken');
    const r = loadSaveData(st, NOW);
    expect(r.data.rounds).toEqual([]);
    expect(r.backupKey).toBeDefined();
    expect(st.map.get(r.backupKey!)).toBe('{"version":1, broken');
  });
});

describe('スキーマ移行', () => {
  it('version を見て移行関数を順に通す', () => {
    const v0 = { version: 0, created: '2026-01-01T00:00:00.000Z', rounds: [] };
    const d = migrate(v0, { 0: (x) => ({ ...x, version: 1, createdAt: x.created }) }, 1);
    expect(d.version).toBe(1);
    expect(d.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('移行方法が無い・新しすぎる・version が無いものはエラー', () => {
    expect(() => migrate({ version: 0 }, {}, 1)).toThrow(SaveDataError);
    expect(() => migrate({ version: CURRENT_VERSION + 1 })).toThrow(/新しい版/);
    expect(() => migrate({ rounds: [] })).toThrow(SaveDataError);
    expect(() => migrate('text')).toThrow(SaveDataError);
    expect(() => migrate({ version: 0 }, { 0: (x) => x }, 1)).toThrow(/進めません/);
  });

  it('正規化: 壊れた要素は捨て、欠けた項目は既定値で補う', () => {
    const d = normalize({
      version: 1,
      settings: { fx: 'ultra', sound: 'yes' },
      games: { 'double-hit': { state: { T: 100, bad: 'x' }, belt: 12, trainingDays: ['2026-09-01', 'nope', '2026-09-01'] } },
      rounds: [round('ok', NOW.toISOString()), { id: 'bad' }, null],
      certs: [{ id: 'c', gameId: 'unknown', at: 'x', tier: 1, passed: true }],
      trials: [trial('ok', 0), { roundId: 'ok' }],
    });
    expect(d.settings).toEqual({ fx: 'light', sound: true, colorSafe: false, bgm: false });
    expect(d.games['double-hit']).toEqual({ state: { T: 100 }, belt: 9, trainingDays: ['2026-09-01'] });
    expect(d.games['stance-change']).toEqual({ state: {}, belt: 0, trainingDays: [] });
    expect(d.rounds.map((r) => r.id)).toEqual(['ok']);
    expect(d.certs).toEqual([]);
    expect(d.trials).toHaveLength(1);
  });
});

describe('試行ログは直近30日', () => {
  it('30日より前のラウンドのログと、ラウンドの無いログを捨てる', () => {
    const rounds = [round('old', '2026-08-29T02:00:00.000Z'), round('new', '2026-08-31T00:00:00.000Z')];
    const logs = [trial('old', 0), trial('new', 0), trial('new', 1), trial('ghost', 0)];
    const kept = pruneTrials(logs, rounds, NOW);
    expect(kept.map((t) => `${t.roundId}:${t.i}`)).toEqual(['new:0', 'new:1']);
  });

  it('保存時に自動で間引く', () => {
    const st = new MemoryStorage();
    const d = defaultSaveData(NOW);
    d.rounds = [round('old', '2026-08-01T00:00:00.000Z'), round('new', '2026-09-28T00:00:00.000Z')];
    d.trials = [trial('old', 0), trial('new', 0)];
    saveSaveData(st, d, NOW);
    const saved = JSON.parse(st.map.get(STORAGE_KEY)!) as SaveData;
    expect(saved.trials!.map((t) => t.roundId)).toEqual(['new']);
    expect(saved.rounds).toHaveLength(2); // ラウンド記録は消さない
  });

  it('容量不足なら試行ログをさらに減らして保存をやり直す', () => {
    const st = new MemoryStorage();
    const d = defaultSaveData(NOW);
    d.rounds = [round('a', '2026-09-10T00:00:00.000Z'), round('b', '2026-09-28T12:00:00.000Z')];
    d.trials = [...Array.from({ length: 50 }, (_, i) => trial('a', i)), trial('b', 0)];
    st.quotaChars = JSON.stringify({ ...d, trials: [trial('b', 0)] }).length + 10;
    const r = saveSaveData(st, d, NOW);
    expect(r).toEqual({ ok: true, pruned: true });
    expect(d.trials.map((t) => t.roundId)).toEqual(['b']);
  });
});

describe('エクスポート／インポート', () => {
  it('ファイル名は brain-fighter-YYYYMMDD.json', () => {
    expect(exportFileName(new Date(2026, 8, 29, 23, 59))).toBe('brain-fighter-20260929.json');
  });

  it('エクスポート → 全消去 → インポートで完全に復元する（受け入れ基準 5）', () => {
    const st = new MemoryStorage();
    const store = new Store(st, () => NOW);
    const d = richData();
    store.replace(structuredClone(d));
    const file = serializeSaveData(store.data);
    store.clearAll();
    expect(st.map.has(STORAGE_KEY)).toBe(false);
    expect(store.data.rounds).toEqual([]);
    const parsed = parseImport(file);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.preview).toEqual({ createdAt: '2026-09-01T00:00:00.000Z', rounds: 1, certs: 1, totalPower: 123 });
    store.replace(parsed.data);
    expect(store.data).toEqual(d);
    // 再読み込みしても同じ
    expect(new Store(st, () => NOW).data).toEqual(d);
  });

  it('読めないファイルはエラーを返す（保存データは変えない）', () => {
    expect(parseImport('not json')).toEqual({ ok: false, error: expect.any(String) });
    expect(parseImport('{"hello":1}').ok).toBe(false);
    expect(parseImport('{"version":99}').ok).toBe(false);
    expect(parseImport('[]').ok).toBe(false);
  });
});
