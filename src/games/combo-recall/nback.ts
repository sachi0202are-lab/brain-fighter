/**
 * コンボ・リコールの試行系列（位置 n-back。仕様書 6.2）。純粋関数だけを置く。
 *
 * - 1ラウンド = 20 + n 試行。標的（n 個前と同じ位置）はちょうど 6 個。
 * - n ≥ 3 ではルアー（n−1 個前か n+1 個前と同じ位置で、n 個前とは違う）をラウンドの 10〜15% 入れる。
 *   それ以外の試行は n±1 個前とも一致させない（偶然のルアーでルアー比率が崩れないように）。
 * - 同じ位置の連続は 2 回まで。
 * - 標的の偏りをなくす: 標的を置ける 20 試行（n 番目以降）を前・中・後に 3 等分して 2 個ずつ置く（時間の偏り）。
 *   標的の位置（どのマスか）は 6 個とも別のマスにする（空間の偏り）。
 * - 乱数は引数の rng だけを使う（Math.random を使わない）。
 */
import type { Rng } from '../../engine/rng';
import { NBACK_RULE } from '../../engine/staircase';

/** 攻撃位置の数（訓練: 3×3 の外周 8 マス。中央は敵。認定戦: 円周上の 8 点） */
export const POSITIONS = 8;
/** 1ラウンドの試行数 = BASE_TRIALS + n */
export const BASE_TRIALS = 20;
/** 1ラウンドの標的数 */
export const TARGETS = 6;
/** 同じ位置の連続の上限 */
export const MAX_RUN = 2;
/** n の範囲（staircase.ts の n-back ルールと同じ） */
export const N_MIN = NBACK_RULE.min;
export const N_MAX = NBACK_RULE.max;
/** ルアーを入れる最小の n */
export const LURE_MIN_N = 3;
/** ルアーの比率（ラウンドの試行数に対して） */
export const LURE_RATIO_MIN = 0.1;
export const LURE_RATIO_MAX = 0.15;
const LURE_RATIO_AIM = 0.125;

/**
 * 標的を置ける 20 試行（添字 n .. n+19）の 3 分割と、それぞれに置く標的の数。
 * 前・中・後に 2 個ずつ置いて、標的が系列の一部に固まらないようにする。
 */
const STRATA: readonly { from: number; to: number; count: number }[] = [
  { from: 0, to: 7, count: 2 },
  { from: 7, to: 14, count: 2 },
  { from: 14, to: BASE_TRIALS, count: 2 },
];

/** 生成の試行回数（厳密: 標的のマスを 6 個とも別に。緩和: 別のマスを優先するだけ） */
const STRICT_ATTEMPTS = 400;
const RELAXED_ATTEMPTS = 4000;

const ALL_POSITIONS: readonly number[] = Array.from({ length: POSITIONS }, (_, k) => k);

/** n を 1〜9 の整数にそろえる（壊れた保存値・範囲外のティア対策） */
export function clampN(n: number): number {
  if (!Number.isFinite(n)) return N_MIN;
  return Math.min(N_MAX, Math.max(N_MIN, Math.round(n)));
}

/** 1ラウンドの試行数（20 + n） */
export function trialCount(n: number): number {
  return BASE_TRIALS + clampN(n);
}

/** 1ラウンドに入れるルアーの数（n < 3 は 0。n ≥ 3 は試行数の約 12.5% を 10〜15% の範囲で） */
export function lureCount(n: number): number {
  const k = clampN(n);
  if (k < LURE_MIN_N) return 0;
  const total = trialCount(k);
  const lo = Math.ceil(total * LURE_RATIO_MIN - 1e-9);
  const hi = Math.floor(total * LURE_RATIO_MAX + 1e-9);
  return Math.min(hi, Math.max(lo, Math.round(total * LURE_RATIO_AIM)));
}

/** 1試行の分類 */
export interface NBackItem {
  /** 攻撃位置 0..POSITIONS-1 */
  pos: number;
  /** 標的: n 個前と同じ位置（押すのが正解） */
  target: boolean;
  /** ルアー: n−1 個前か n+1 個前と同じ位置で、n 個前とは違う（押さないのが正解） */
  lure: boolean;
}

/**
 * 位置の並びから、各試行が標的・ルアーかを判定する（生成結果の検証、ログの読み取り、テストで使う）。
 * ルアーの判定は n によらず同じ定義（n = 1 は 0 個前を数えないので 2 個前だけ）。
 * ただし比率をそろえて入れるのは n ≥ 3 だけで、n ≤ 2 のルアーは偶然の一致。
 */
export function classify(positions: readonly number[], nIn: number): NBackItem[] {
  const n = clampN(nIn);
  return positions.map((pos, i) => {
    const target = i >= n && positions[i - n] === pos;
    const nearMinus = n >= 2 && i >= n - 1 && positions[i - (n - 1)] === pos;
    const nearPlus = i >= n + 1 && positions[i - (n + 1)] === pos;
    return { pos, target, lure: !target && (nearMinus || nearPlus) };
  });
}

/** 同じ値が続く最長の長さ */
export function longestRun(positions: readonly number[]): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < positions.length; i++) {
    run = i > 0 && positions[i] === positions[i - 1] ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/**
 * 標的の添字を選ぶ: 前・中・後の各区間に 2 個ずつ。
 * 「i と i−n の両方が標的」（同じマスの連鎖）は作らない。連鎖すると標的のマスが重なり、n = 1 では同じマスが 3 連続になるため。
 */
function pickTargets(n: number, rng: Rng): number[] | null {
  const chosen: number[] = [];
  for (const s of STRATA) {
    for (let k = 0; k < s.count; k++) {
      const candidates: number[] = [];
      for (let off = s.from; off < s.to; off++) {
        const i = n + off;
        if (chosen.includes(i) || chosen.includes(i - n) || chosen.includes(i + n)) continue;
        candidates.push(i);
      }
      if (candidates.length === 0) return null;
      chosen.push(rng.pick(candidates));
    }
  }
  return chosen.sort((a, b) => a - b);
}

/** ルアーの添字を選ぶ（n+1 番目以降の、標的でも「標的の n 個前」でもない試行から） */
function pickLures(n: number, total: number, targets: ReadonlySet<number>, sources: ReadonlySet<number>, rng: Rng): Set<number> | null {
  const want = lureCount(n);
  if (want === 0) return new Set();
  const candidates: number[] = [];
  for (let i = n + 1; i < total; i++) {
    if (!targets.has(i) && !sources.has(i)) candidates.push(i);
  }
  if (candidates.length < want) return null;
  return new Set(rng.shuffle(candidates).slice(0, want));
}

/** 1回ぶんの生成。制約を満たせなければ null（呼び出し側がやり直す） */
function tryGenerate(n: number, rng: Rng, strictBalance: boolean): number[] | null {
  const total = trialCount(n);
  const targetList = pickTargets(n, rng);
  if (!targetList) return null;
  const targets = new Set(targetList);
  // 「標的の n 個前」の試行。ここで選ぶマスが標的のマスになる
  const sources = new Set(targetList.map((t) => t - n));
  const lures = pickLures(n, total, targets, sources, rng);
  if (!lures) return null;

  const pos: number[] = [];
  const at = (i: number): number => pos[i] as number;
  const usedTargetPos = new Set<number>();
  for (let i = 0; i < total; i++) {
    // ここに置くと同じ位置が 3 連続になるマス
    const runBlocked = i >= 2 && at(i - 1) === at(i - 2) ? at(i - 1) : null;

    if (targets.has(i)) {
      const p = at(i - n);
      if (p === runBlocked) return null;
      pos.push(p);
      continue;
    }

    const banned = new Set<number>();
    if (runBlocked !== null) banned.add(runBlocked);
    // 標的以外は n 個前と違うマス
    if (i >= n) banned.add(at(i - n));
    // 次が標的（位置は i+1−n 個目で決まっている）なら、ここで同じマスを続けて 3 連続にしない
    if (n >= 2 && targets.has(i + 1) && at(i - 1) === at(i + 1 - n)) banned.add(at(i - 1));

    if (lures.has(i)) {
      const options = [...new Set([at(i - (n - 1)), at(i - (n + 1))])].filter((p) => !banned.has(p));
      if (options.length === 0) return null;
      pos.push(rng.pick(options));
      continue;
    }

    // ルアーの比率を守るため、n ≥ 3 の通常の試行は n±1 個前とも違うマスにする
    if (n >= LURE_MIN_N) {
      if (i - (n - 1) >= 0) banned.add(at(i - (n - 1)));
      if (i - (n + 1) >= 0) banned.add(at(i - (n + 1)));
    }
    let allowed = ALL_POSITIONS.filter((p) => !banned.has(p));
    if (sources.has(i)) {
      const fresh = allowed.filter((p) => !usedTargetPos.has(p));
      if (fresh.length > 0) allowed = fresh;
      else if (strictBalance) return null;
    }
    if (allowed.length === 0) return null;
    const p = rng.pick(allowed);
    if (sources.has(i)) usedTargetPos.add(p);
    pos.push(p);
  }

  // 念のため、でき上がった系列そのものを数え直して確かめる
  const items = classify(pos, n);
  if (items.filter((it) => it.target).length !== TARGETS) return null;
  if (!items.every((it, i) => it.target === targets.has(i))) return null;
  if (n >= LURE_MIN_N && items.filter((it) => it.lure).length !== lures.size) return null;
  if (longestRun(pos) > MAX_RUN) return null;
  return pos;
}

/**
 * 1ラウンドぶんの系列を作る。まず標的のマスを 6 個とも別にする厳密な条件で試し、
 * （実際には起きないが）見つからなければ、標的のマスが重なるのを許して作り直す。
 * 標的の数・ルアーの数・連続の上限は、どちらでも必ず守る。
 */
export function generateSequence(nIn: number, rng: Rng): NBackItem[] {
  const n = clampN(nIn);
  for (const [strict, attempts] of [
    [true, STRICT_ATTEMPTS],
    [false, RELAXED_ATTEMPTS],
  ] as const) {
    for (let a = 0; a < attempts; a++) {
      const pos = tryGenerate(n, rng, strict);
      if (pos) return classify(pos, n);
    }
  }
  throw new Error(`combo-recall: n=${n} の系列を作れませんでした`);
}
