/**
 * 試行系列づくりの共通部品。
 * 仕様書 4.2「系列は乱数で生成する。同じ刺激の連続は上限を設けるが、予測可能なパターンは作らない」。
 */
import type { Rng } from './rng';

/** 系列の中で同じ値が続く最長の長さ */
export function maxRunLength<T>(seq: readonly T[], eq: (a: T, b: T) => boolean = Object.is): number {
  let best = 0;
  let run = 0;
  for (let i = 0; i < seq.length; i++) {
    run = i > 0 && eq(seq[i] as T, seq[i - 1] as T) ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

/** n を values.length 個に均等に配る（端数はランダムな値に +1） */
export function balancedCounts(rng: Rng, n: number, k: number): number[] {
  const base = Math.floor(n / k);
  const counts = new Array<number>(k).fill(base);
  const extra = rng.shuffle([...Array(k).keys()]).slice(0, n - base * k);
  for (const idx of extra) counts[idx] = (counts[idx] as number) + 1;
  return counts;
}

function lastRun<T>(seq: readonly T[], v: T): number {
  let r = 0;
  for (let i = seq.length - 1; i >= 0 && Object.is(seq[i], v); i--) r++;
  return r;
}

/**
 * 各値の出現回数を均等（差は最大1）にした長さ n の系列。同じ値の連続は maxRun 以下。
 * 例: 火花の8方向（連続2回まで）、構えの 50%。
 */
export function balancedSequence<T>(
  rng: Rng,
  n: number,
  values: readonly T[],
  maxRun: number = Number.POSITIVE_INFINITY,
): T[] {
  if (values.length === 0) throw new RangeError('balancedSequence: values が空');
  const counts0 = balancedCounts(rng, n, values.length);
  for (let attempt = 0; attempt < 500; attempt++) {
    const counts = counts0.slice();
    const seq: T[] = [];
    let ok = true;
    for (let i = 0; i < n; i++) {
      let total = 0;
      const allowed: number[] = [];
      for (let k = 0; k < values.length; k++) {
        const c = counts[k] as number;
        if (c > 0 && lastRun(seq, values[k] as T) < maxRun) {
          allowed.push(k);
          total += c;
        }
      }
      if (allowed.length === 0) {
        ok = false;
        break;
      }
      let r = rng.next() * total;
      let chosen = allowed[allowed.length - 1] as number;
      for (const k of allowed) {
        r -= counts[k] as number;
        if (r < 0) {
          chosen = k;
          break;
        }
      }
      counts[chosen] = (counts[chosen] as number) - 1;
      seq.push(values[chosen] as T);
    }
    if (ok) return seq;
  }
  // 制約を満たせない組合せ（値の種類が少なすぎる等）: 連続制約を諦めて均等だけ守る
  const pool: T[] = [];
  counts0.forEach((c, k) => {
    for (let j = 0; j < c; j++) pool.push(values[k] as T);
  });
  return rng.shuffle(pool);
}

/**
 * 各試行を独立に一様に選び、同じ値の連続を maxRun 以下にした系列（出現回数は均等にしない）。
 */
export function randomSequence<T>(
  rng: Rng,
  n: number,
  values: readonly T[],
  maxRun: number = Number.POSITIVE_INFINITY,
): T[] {
  if (values.length === 0) throw new RangeError('randomSequence: values が空');
  const seq: T[] = [];
  for (let i = 0; i < n; i++) {
    const allowed = values.filter((v) => lastRun(seq, v) < maxRun);
    seq.push(rng.pick(allowed.length > 0 ? allowed : values));
  }
  return seq;
}
