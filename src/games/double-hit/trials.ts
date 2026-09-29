/**
 * ダブルヒットの試行列・判定（仕様書 6.1）。
 *
 * 位置の単位: 刺激領域の中心が原点、刺激領域の半径 R（= 一辺の半分）を 1 とする。x は右、y は下。
 *
 * - 火花: 偏心度 e（= eccPct / 100）の円周上、8 方向のどれか。8 方向を均等に（24 試行で各 3 回）、同じ方向の連続は 2 回まで。
 * - 構え: 2 種なら 50% ずつ（24 試行で 12 回ずつ）、3 種なら 1/3 ずつ。同じ構えの連続は 4 回まで。
 * - 妨害: 下の「置き場所」（火花の円周の残り 7 か所と、内側・外側の同心円）から、火花の位置を除いて N 個を毎試行ランダムに選ぶ。
 *   形・向きも毎試行ランダム。乱数は createRound に渡る rng だけを使う。
 */
import type { Rng } from '../../engine/rng';
import { balancedSequence } from '../../engine/sequence';
import { clamp } from '../../engine/staircase';
import type { Judgement, Response } from '../../engine/types';
import { DIR_GROUP, DIR_IDS, STANCE_GROUP, dirIndex, stanceSet, type DirId, type StanceId } from './layout';
import type { DhParams } from './params';

/** 1ラウンドの試行数 */
export const TRIALS_PER_ROUND = 24;
/** 同じ方向の連続の上限（仕様書 6.1） */
export const DIR_MAX_RUN = 2;
/** 同じ構えの連続の上限（仕様書に指定なし。予測できる長い連続を避ける） */
export const STANCE_MAX_RUN = 4;
/** 妨害の形の種類数（形のセットは訓練と認定戦で別。描画側で決める） */
export const DISTRACTOR_SHAPES = 3;

export interface Distractor {
  /** 位置（半径 R = 1 の単位、中心が原点、y は下向き） */
  x: number;
  y: number;
  /** 形の番号 0..DISTRACTOR_SHAPES-1 */
  shape: number;
  /** 向き 0..3（90° 単位） */
  rot: number;
}

export interface DhTrial {
  /** 中央の構え（正解） */
  stance: StanceId;
  /** 火花の方向（正解） */
  dir: DirId;
  /** 火花の偏心度（刺激領域の半径に対する %） */
  eccPct: number;
  /** このラウンドの構えの種類数（2 か 3） */
  stances: number;
  distractors: Distractor[];
  /** マスク（砂嵐）の模様の種。描画の中で乱数を使わないために試行データに入れておく */
  maskSeed: number;
}

// ---------------------------------------------------------------------------
// 置き場所（火花と妨害）
// ---------------------------------------------------------------------------

/** 同心円の間隔（半径に対する比） */
export const RING_STEP = 0.15;
/** 内側の同心円の最小半径（中央のシルエット ±0.22 に重ならない） */
export const INNER_MIN = 0.28;
/** 外側の同心円の最大半径（刺激領域の内接円の内側に収める） */
export const OUTER_MAX = 0.9;

export interface Slot {
  x: number;
  y: number;
  /** 何番目の同心円か（0 = 火花の円周） */
  ring: number;
}

const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;

function ringSlots(r: number, count: number, phase: number, ring: number): Slot[] {
  const out: Slot[] = [];
  for (let k = 0; k < count; k++) {
    const a = ((k + phase) * 2 * Math.PI) / count;
    out.push({ x: round4(r * Math.cos(a)), y: round4(-r * Math.sin(a)), ring });
  }
  return out;
}

const slotCache = new Map<number, Slot[]>();

/**
 * 偏心度 eccPct のときの置き場所。先頭の 8 つが火花の円周（DIRS の順 = 方向の index）。
 * 残りは内側（入るときだけ）と外側の同心円で、火花の円周からは半歩ずらして並べる。
 * 隣り合う置き場所の中心距離は約 0.15 以上（火花とは 0.16 以上）なので、図形どうしは重ならない。
 */
export function slotsFor(eccPct: number): Slot[] {
  const cached = slotCache.get(eccPct);
  if (cached) return cached;
  const e = eccPct / 100;
  const slots: Slot[] = ringSlots(e, 8, 0, 0);
  let ring = 1;
  for (let r = e - RING_STEP; r >= INNER_MIN - 1e-9; r -= RING_STEP) slots.push(...ringSlots(r, 8, 0.5, ring++));
  for (let r = e + RING_STEP; r <= OUTER_MAX + 1e-9; r += RING_STEP) slots.push(...ringSlots(r, r < 0.55 ? 16 : 24, 0.5, ring++));
  slotCache.set(eccPct, slots);
  return slots;
}

/** 火花の位置（半径 R = 1 の単位） */
export function sparkPosition(trial: Pick<DhTrial, 'dir' | 'eccPct'>): { x: number; y: number } {
  const s = slotsFor(trial.eccPct)[dirIndex(trial.dir)] as Slot;
  return { x: s.x, y: s.y };
}

// ---------------------------------------------------------------------------
// 試行列
// ---------------------------------------------------------------------------

/** 1ラウンドぶんの試行列（難度 params はラウンド開始時の値。T は試行ごとに phases で反映する） */
export function createTrials(params: DhParams, rng: Rng, n: number = TRIALS_PER_ROUND): DhTrial[] {
  const stanceIds = stanceSet(params.stances);
  const stances = balancedSequence<StanceId>(rng, n, stanceIds, STANCE_MAX_RUN);
  const dirs = balancedSequence<DirId>(rng, n, DIR_IDS, DIR_MAX_RUN);
  const eccPct = params.eccPct;
  const slots = slotsFor(eccPct);
  const count = clamp(Math.round(params.distractors), 0, slots.length - 1);
  return stances.map((stance, i) => {
    const dir = dirs[i] as DirId;
    const sparkSlot = dirIndex(dir);
    let distractors: Distractor[] = [];
    if (count > 0) {
      const free = slots.filter((_, k) => k !== sparkSlot);
      distractors = rng
        .shuffle(free)
        .slice(0, count)
        .map((s) => ({ x: s.x, y: s.y, shape: rng.int(0, DISTRACTOR_SHAPES), rot: rng.int(0, 4) }));
    }
    return { stance, dir, eccPct, stances: stanceIds.length, distractors, maskSeed: rng.int(0, 2 ** 31) };
  });
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** 誤答の内訳（RoundRecord.errors のキー） */
export const ERROR_KINDS = {
  /** 構えだけ誤り（火花の方向は正しい） */
  stance: 'stance',
  /** 火花の方向だけ誤り（構えは正しい） */
  dir: 'dir',
  /** 両方誤り */
  both: 'both',
  /** 5 秒以内に両方を答えられなかった（無応答・片方だけ） */
  timeout: 'timeout',
} as const;

/** 両方正解で正答。片方だけ正解は誤答（内訳を kind に分ける） */
export function judgeTrial(trial: DhTrial, response: Response | null): Judgement {
  const stance = response?.[STANCE_GROUP];
  const dir = response?.[DIR_GROUP];
  if (stance === undefined || dir === undefined) return { correct: false, kind: ERROR_KINDS.timeout };
  const stanceOk = stance === trial.stance;
  const dirOk = dir === trial.dir;
  if (stanceOk && dirOk) return { correct: true };
  return { correct: false, kind: stanceOk ? ERROR_KINDS.dir : dirOk ? ERROR_KINDS.stance : ERROR_KINDS.both };
}

export function expectedResponse(trial: DhTrial): Response {
  return { [STANCE_GROUP]: trial.stance, [DIR_GROUP]: trial.dir };
}

/** TrialLog.stim 用: 構え/方向/妨害数/偏心度（例 "high/d9/x12/e35"） */
export function describeTrial(trial: DhTrial): string {
  return `${trial.stance}/${trial.dir}/x${trial.distractors.length}/e${trial.eccPct}`;
}
