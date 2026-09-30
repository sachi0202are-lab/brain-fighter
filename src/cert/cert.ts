/**
 * 認定戦（昇段審査）のルール（仕様書 第5.2節・第7節）。純粋関数だけ（画面・保存の仕組み・時計を知らない）。
 *
 * - いつ: そのゲームの訓練日数が 3 日以上、かつ前回の認定戦から 7 日以上（engine/session.ts の certAvailability）。
 *   ベルトが最上位（9 = 黒帯二段）なら、それより上の審査は無い。
 * - 内容: 「現在のベルト + 1」のティアの固定難度（GameModule.certParams）・未訓練の刺激セット（untrained: true）・
 *   2 ラウンド（試行数は訓練と同じ = 同じ createRound。スタンスチェンジは 2 × 16 試行）。適応しない（adapt / adaptTrial を呼ばない。runner.ts）。
 * - 合格: 2 ラウンドとも certRoundPassed（既定: 正答率 79% 以上 = ダブルヒット 24 試行中 19、スタンスチェンジ 16 試行中 13。
 *   コンボ・リコールは誤り 4 以下）。合格でベルト +1。不合格でもベルトは下がらない。
 * - 記録: CertRecord（訓練とは別のテーブル）。訓練量（rounds・trainingDays・trials）と戦闘力には数えない。
 *   審査は1ラウンド目を始めた時点で「受けた」と記録する（途中でやめても不合格として残り、次は 7 日後）。
 */
import { certAvailability, type CertAvailability } from '../engine/session';
import { certRoundPassed, type AnyGameModule, type RoundStats } from '../engine/types';
import { GAME_IDS, type CertRecord, type GameId, type GameSave, type SaveData } from '../storage/schema';

/** ベルトの最上位（9 = 黒帯二段） */
export const MAX_BELT = 9;
/** 1回の審査のラウンド数 */
export const CERT_ROUNDS = 2;

const clampBelt = (belt: number): number => Math.min(MAX_BELT, Math.max(0, Math.round(Number.isFinite(belt) ? belt : 0)));

/** 次に受けるティア（= 現在のベルト + 1）。最上位なら null */
export function certTier(belt: number): number | null {
  const b = clampBelt(belt);
  return b >= MAX_BELT ? null : b + 1;
}

export interface CertStatus extends CertAvailability {
  /** 受けるティア（最上位なら null） */
  tier: number | null;
  /** ベルトが最上位 */
  maxed: boolean;
}

/** そのゲームの審査の状態（解放条件 + ベルトが最上位でないこと） */
export function certStatus(game: GameSave, now: Date): CertStatus {
  const a = certAvailability(game, now);
  const tier = certTier(game.belt);
  return { ...a, available: a.available && tier !== null, tier, maxed: tier === null };
}

/** いま審査を受けられるゲーム（GAME_IDS の順） */
export function availableCertGames(data: SaveData, now: Date): GameId[] {
  return GAME_IDS.filter((g) => certStatus(data.games[g], now).available);
}

export interface CertVerdict {
  /** ラウンドごとの合否 */
  roundPassed: boolean[];
  /** 2 ラウンドとも合格 */
  passed: boolean;
}

/** 合否（2 ラウンドとも certRoundPassed で合格。ラウンドが足りなければ不合格） */
export function judgeCert(game: AnyGameModule, tier: number, rounds: readonly RoundStats[]): CertVerdict {
  const roundPassed = rounds.map((r) => certRoundPassed(game, r, tier));
  return { roundPassed, passed: rounds.length === CERT_ROUNDS && roundPassed.every(Boolean) };
}

/** 保存用の1ラウンド（正答率だけ残す） */
export function certRoundOf(s: RoundStats): { trials: number; correct: number } {
  return { trials: s.trials, correct: s.correct };
}

/**
 * 審査を始めたときの記録（1ラウンド目の開始時）。不合格・ラウンド 0 本で CertRecord を作り、lastCertAt を進める。
 * 途中でやめたり画面を閉じたりしても、この「不合格（途中まで）」の記録が残る。
 */
export function beginCert(data: SaveData, args: { id: string; gameId: GameId; at: string; tier: number }): CertRecord {
  const rec: CertRecord = { id: args.id, gameId: args.gameId, at: args.at, tier: args.tier, rounds: [], passed: false };
  data.certs.push(rec);
  data.games[args.gameId].lastCertAt = args.at;
  return rec;
}

/** 1ラウンド終えるたびに記録へ足す */
export function addCertRound(data: SaveData, id: string, round: RoundStats): void {
  const rec = data.certs.find((c) => c.id === id);
  if (rec) rec.rounds.push(certRoundOf(round));
}

/** 審査を終えたとき: 合否を確定し、合格ならベルトを上げる（下げることは無い） */
export function finishCert(data: SaveData, id: string, passed: boolean): void {
  const rec = data.certs.find((c) => c.id === id);
  if (!rec) return;
  rec.passed = passed;
  if (passed) {
    const g = data.games[rec.gameId];
    g.belt = Math.max(clampBelt(g.belt), clampBelt(rec.tier));
  }
}

/** 途中でやめた記録か（ラウンドが 2 本そろっていない） */
export function isIncomplete(rec: CertRecord): boolean {
  return rec.rounds.length < CERT_ROUNDS;
}

/** 記録用の正答率（全試行が 0 なら 0） */
export function accuracyOf(r: { trials: number; correct: number }): number {
  return r.trials > 0 ? r.correct / r.trials : 0;
}
