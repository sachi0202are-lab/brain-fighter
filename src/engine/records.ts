/** ラウンドの結果を保存用の RoundRecord / TrialLog に変換する */
import type { FxPreset, GameId, RoundRecord, TrialLog } from '../storage/schema';
import type { RoundDone } from './match';
import { formatResponse, type TrialResult } from './types';

const r1 = (v: number): number => Math.round(v * 10) / 10;

export function toRoundRecord(args: {
  id: string;
  gameId: GameId;
  matchId: string;
  startedAt: string;
  fx: FxPreset;
  done: RoundDone;
}): RoundRecord {
  const { done } = args;
  const s = done.summary;
  const rec: RoundRecord = {
    id: args.id,
    gameId: args.gameId,
    startedAt: args.startedAt,
    fx: args.fx,
    paramsStart: { ...s.paramsStart },
    paramsEnd: { ...done.paramsEnd },
    trials: s.trials,
    correct: s.correct,
    errors: { ...s.errors },
    power: done.power,
    matchId: args.matchId,
    roundNo: s.roundNo,
    maxCombo: s.maxCombo,
    seed: done.seed,
    frameMs: Math.round(s.frameMs * 1000) / 1000,
  };
  if (s.kind === 'warmup') rec.kind = 'warmup';
  if (s.rtMedianMs !== undefined) rec.rtMedianMs = r1(s.rtMedianMs);
  if (Object.keys(done.metrics).length > 0) rec.metrics = { ...done.metrics };
  return rec;
}

/** 1試行の詳しい結果 → 保存用の生ログ */
export function toTrialLog(roundId: string, r: TrialResult): TrialLog {
  const log: TrialLog = {
    roundId,
    i: r.i,
    onsetMs: r1(r.onsetMs),
    stim: r.stim,
    correct: r.correct,
    plan: Object.fromEntries(r.phases.map((p) => [p.name, r1(p.plannedMs)])),
  };
  const resp = formatResponse(r.response);
  if (resp !== undefined) log.resp = resp;
  if (r.rtMs !== undefined) log.rtMs = r1(r.rtMs);
  const stim = r.phases.find((p) => p.name === 'stimulus');
  if (stim) log.stimMs = r1(stim.endMs - stim.startMs);
  return log;
}

export function toTrialLogs(roundId: string, results: readonly TrialResult[]): TrialLog[] {
  return results.map((r) => toTrialLog(roundId, r));
}
