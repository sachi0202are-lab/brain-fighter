import { describe, expect, it } from 'vitest';
import type { GameSave, SessionRecord } from '../storage/schema';
import { localDate } from './dates';
import {
  allTrainingDays,
  certAvailability,
  createSession,
  markGameDone,
  sessionAvailability,
  sessionOrder,
  weekTrainingDays,
} from './session';

/** ローカル時刻で日時を作る（テストが TZ に依存しないように） */
const at = (y: number, mo: number, d: number, h = 0, mi = 0): Date => new Date(y, mo - 1, d, h, mi);

function session(start: Date, done: SessionRecord['done'], end?: Date): SessionRecord {
  const s: SessionRecord = { id: 's', startedAt: start.toISOString(), order: sessionOrder(localDate(start)), done };
  if (end) s.endedAt = end.toISOString();
  return s;
}

describe('日替わりローテーション', () => {
  it('同じ日は同じ順番、3日で3通りに回る', () => {
    const a = sessionOrder('2026-09-28');
    const b = sessionOrder('2026-09-29');
    const c = sessionOrder('2026-09-30');
    const d = sessionOrder('2026-10-01');
    expect(sessionOrder('2026-09-28')).toEqual(a);
    expect(new Set([a.join(), b.join(), c.join()]).size).toBe(3);
    expect(d).toEqual(a);
    for (const o of [a, b, c]) expect([...o].sort()).toEqual(['combo-recall', 'double-hit', 'stance-change']);
  });
});

describe('1日のセッションの回数と間隔', () => {
  it('記録が無ければ開始できる', () => {
    const r = sessionAvailability([], at(2026, 9, 29, 10));
    expect(r.status).toBe('available');
  });

  it('今日の途中のセッションがあれば続きから（次のゲームを返す）', () => {
    const s = session(at(2026, 9, 29, 9), []);
    s.done = [s.order[0]!];
    const r = sessionAvailability([s], at(2026, 9, 29, 9, 30));
    expect(r.status).toBe('resume');
    if (r.status === 'resume') expect(r.next).toBe(s.order[1]);
  });

  it('1試合も終えていないセッションも続きから（回数には数えない）', () => {
    const s = session(at(2026, 9, 29, 9), []);
    const r = sessionAvailability([s], at(2026, 9, 29, 9, 5));
    expect(r.status).toBe('resume');
  });

  it('同じ日の2回目は、1回目を終えてから4時間以上あける', () => {
    const s = session(at(2026, 9, 29, 9), [], at(2026, 9, 29, 10));
    s.done = [...s.order];
    const early = sessionAvailability([s], at(2026, 9, 29, 13, 59));
    expect(early.status).toBe('wait');
    if (early.status === 'wait') expect(early.availableAt.getTime()).toBe(at(2026, 9, 29, 14).getTime());
    expect(sessionAvailability([s], at(2026, 9, 29, 14)).status).toBe('available');
  });

  it('1日の上限は2セッション', () => {
    const s1 = session(at(2026, 9, 29, 8), [], at(2026, 9, 29, 8, 15));
    s1.done = [...s1.order];
    const s2 = session(at(2026, 9, 29, 13), [], at(2026, 9, 29, 13, 15));
    s2.done = [...s2.order];
    expect(sessionAvailability([s1, s2], at(2026, 9, 29, 20)).status).toBe('limit');
    // 次の日はまた遊べる
    expect(sessionAvailability([s1, s2], at(2026, 9, 30, 7)).status).toBe('available');
  });

  it('待ち時間は日付が変わるところまで（翌日は別の日）', () => {
    const s = session(at(2026, 9, 29, 22), [], at(2026, 9, 29, 22, 30));
    s.done = [...s.order];
    const r = sessionAvailability([s], at(2026, 9, 29, 23));
    expect(r.status).toBe('wait');
    if (r.status === 'wait') expect(r.availableAt.getTime()).toBe(at(2026, 9, 30, 0).getTime());
  });

  it('前日の途中のセッションは続きにならない', () => {
    const s = session(at(2026, 9, 28, 21), []);
    s.done = [s.order[0]!];
    expect(sessionAvailability([s], at(2026, 9, 29, 8)).status).toBe('available');
  });

  it('createSession / markGameDone', () => {
    const now = at(2026, 9, 29, 9);
    const s = createSession(now);
    expect(s.done).toEqual([]);
    expect(s.order).toEqual(sessionOrder('2026-09-29'));
    const s2 = markGameDone(s, s.order[0]!, at(2026, 9, 29, 9, 5));
    expect(s2.done).toEqual([s.order[0]]);
    expect(s2.endedAt).toBe(at(2026, 9, 29, 9, 5).toISOString());
    expect(markGameDone(s2, s.order[0]!, now).done).toHaveLength(1);
  });
});

describe('今週 x / 5 日（月曜始まり）', () => {
  it('今週の日だけ数える', () => {
    // 2026-09-29 は火曜。今週 = 9/28(月)〜
    const days = ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-29', '2026-10-01'];
    expect(weekTrainingDays(days, at(2026, 9, 29, 12))).toBe(2);
    expect(weekTrainingDays(days, at(2026, 10, 4, 12))).toBe(3);
    expect(weekTrainingDays(days, at(2026, 10, 5, 12))).toBe(0);
  });

  it('3ゲームの訓練日の和集合', () => {
    const g = (days: string[]): GameSave => ({ state: {}, belt: 0, trainingDays: days });
    expect(
      allTrainingDays({
        'double-hit': g(['2026-09-28', '2026-09-29']),
        'combo-recall': g(['2026-09-29']),
        'stance-change': g(['2026-09-30']),
      }),
    ).toEqual(['2026-09-28', '2026-09-29', '2026-09-30']);
  });
});

describe('認定戦の解放条件（訓練3日以上・前回から7日以上）', () => {
  const g = (days: number, lastCertAt?: Date): GameSave => {
    const s: GameSave = {
      state: {},
      belt: 0,
      trainingDays: Array.from({ length: days }, (_, k) => `2026-09-${String(10 + k).padStart(2, '0')}`),
    };
    if (lastCertAt) s.lastCertAt = lastCertAt.toISOString();
    return s;
  };

  it('訓練2日では出ない、3日で出る', () => {
    expect(certAvailability(g(2), at(2026, 9, 29)).available).toBe(false);
    expect(certAvailability(g(2), at(2026, 9, 29)).daysOk).toBe(false);
    expect(certAvailability(g(3), at(2026, 9, 29)).available).toBe(true);
  });

  it('前回から6日では出ない、7日で出る', () => {
    const last = at(2026, 9, 22, 20);
    const six = certAvailability(g(5, last), at(2026, 9, 28, 23));
    expect(six.available).toBe(false);
    expect(six.intervalOk).toBe(false);
    expect(six.nextDate).toBe('2026-09-29');
    expect(certAvailability(g(5, last), at(2026, 9, 29, 0, 1)).available).toBe(true);
  });

  it('同じ日を何度数えても1日', () => {
    const s: GameSave = { state: {}, belt: 0, trainingDays: ['2026-09-10', '2026-09-10', '2026-09-11'] };
    expect(certAvailability(s, at(2026, 9, 29)).trainingDays).toBe(2);
  });
});
