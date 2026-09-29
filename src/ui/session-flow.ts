/** 「今日のセッション」の開始・続き・試合終了時の更新 */
import { localDate } from '../engine/dates';
import { createSession, isSessionFinished, markGameDone, sessionAvailability } from '../engine/session';
import type { GameId, SessionRecord } from '../storage/schema';
import type { App } from './app';

/** 古いセッション記録は 60 日で捨てる（回数と間隔の判定は当日分しか使わない） */
const SESSION_KEEP_DAYS = 60;

/** 今日のセッションを始める（途中なら続きから）。遷移したら true */
export function startOrResumeSession(app: App, now: Date = new Date()): boolean {
  const av = sessionAvailability(app.store.data.sessions ?? [], now);
  if (av.status === 'resume') {
    app.navigate(`/play/${av.next}`);
    return true;
  }
  if (av.status !== 'available') return false;
  const s = createSession(now, av.order);
  const cutoff = now.getTime() - SESSION_KEEP_DAYS * 86_400_000;
  app.store.update((d) => {
    d.sessions = [...(d.sessions ?? []).filter((x) => Date.parse(x.startedAt) >= cutoff), s];
  });
  app.navigate(`/play/${s.order[0]}`);
  return true;
}

/** 試合を終えたとき: 今日の途中のセッションにそのゲームが残っていれば「済み」にする */
export function completeGameInSession(app: App, gameId: GameId, now: Date = new Date()): SessionRecord | null {
  const today = localDate(now);
  const sessions = app.store.data.sessions ?? [];
  for (let k = sessions.length - 1; k >= 0; k--) {
    const s = sessions[k] as SessionRecord;
    if (localDate(new Date(s.startedAt)) !== today || isSessionFinished(s)) continue;
    if (!s.order.includes(gameId) || s.done.includes(gameId)) continue;
    const next = markGameDone(s, gameId, now);
    app.store.update((d) => {
      const list = d.sessions ?? [];
      const idx = list.findIndex((x) => x.id === s.id);
      if (idx >= 0) list[idx] = next;
      d.sessions = list;
    });
    return next;
  }
  return null;
}
