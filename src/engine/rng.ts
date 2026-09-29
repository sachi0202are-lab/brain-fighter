/**
 * シード可能な擬似乱数（mulberry32）。
 * 試行列の生成は必ずこの Rng を通す（Math.random を使わない）。同じシードなら同じ系列になる。
 * URL の `?seed=123`（数字以外の文字列も可）でシードを固定できる。
 */

export interface Rng {
  /** この Rng を作ったシード（uint32） */
  readonly seed: number;
  /** [0, 1) の一様乱数 */
  next(): number;
  /** [min, maxExclusive) の整数 */
  int(min: number, maxExclusive: number): number;
  /** 配列から1つ選ぶ（空配列は例外） */
  pick<T>(items: readonly T[]): T;
  /** 並べ替えた新しい配列を返す（Fisher–Yates） */
  shuffle<T>(items: readonly T[]): T[];
  /** 確率 p で true */
  chance(p: number): boolean;
  /** ラベルから独立した子 Rng を作る（親の消費量に依存しない） */
  fork(label: string | number): Rng;
}

/** mulberry32 の Rng を作る */
export function mulberry32(seed: number): Rng {
  const initial = seed >>> 0;
  let a = initial;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed: initial,
    next,
    int(min, maxExclusive) {
      if (!(maxExclusive > min)) throw new RangeError(`int(${min}, ${maxExclusive}): 範囲が空です`);
      return min + Math.floor(next() * (maxExclusive - min));
    },
    pick(items) {
      if (items.length === 0) throw new RangeError('pick: 空の配列');
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    shuffle(items) {
      const out = items.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = out[i] as (typeof out)[number];
        out[i] = out[j] as (typeof out)[number];
        out[j] = tmp;
      }
      return out;
    },
    chance(p) {
      return next() < p;
    },
    fork(label) {
      return mulberry32(hashSeed(initial, 'fork', label));
    },
  };
  return rng;
}

/** 文字列・数値の並びから uint32 のシードを作る（FNV-1a + murmur3 fmix32） */
export function hashSeed(...parts: Array<string | number>): number {
  const s = parts.map(String).join('␟');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 暗号学的乱数（無ければ Math.random）でシードを作る */
export function randomSeed(): number {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    return c.getRandomValues(new Uint32Array(1))[0] as number;
  }
  return Math.floor(Math.random() * 4294967296) >>> 0;
}

/**
 * URL のクエリ（`location.search`）から `seed` を読む。
 * 非負整数ならその値、それ以外の文字列ならハッシュ値。指定が無ければ null。
 */
export function parseSeed(search: string): number | null {
  const raw = new URLSearchParams(search).get('seed');
  if (raw === null || raw.trim() === '') return null;
  const t = raw.trim();
  if (/^\d+$/.test(t)) return Number(t) >>> 0;
  return hashSeed(t);
}

/**
 * ラウンドごとのシード。URL でシードが固定されていれば (シード, ゲーム, 種類, ラウンド番号) から決定的に作り、
 * 固定されていなければ毎回ランダム。
 */
export function roundSeed(
  fixed: number | null,
  gameId: string,
  kind: string,
  roundNo: number,
): number {
  return fixed === null ? randomSeed() : hashSeed(fixed, gameId, kind, roundNo);
}
