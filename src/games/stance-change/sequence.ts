/**
 * 試行列づくり（仕様書 6.3「系列」）。乱数は渡された rng だけを使う。
 *
 * - 構えの切替率 50%・完全ランダム。同じ構えの連続は 4 回まで（= 反復の連続は 3 回まで）。
 *   ラウンド最初の試行は前が無いので切替にも反復にも数えない。残り 29 回の移り変わりのうち
 *   切替を 14 か 15（どちらかはランダム）にして、並びは乱数で決める（交互や AABB のような型は作らない）。
 *   3 ルールでは、切替先を残り2つの構えから等確率で選ぶ。
 * - 一致試行（どの判断軸で答えても同じ応答）と不一致試行を 50/50。正解の左右も 50/50。
 *   切替／反復 × 構えの組ごとに偏らないよう、層ごとに交互に割り当ててから並びをランダムにする。
 * - 属性（高さ・色・形）はそれぞれ 50%（正解の左右が 50/50 で、一致・不一致を左右と独立に決めるため）。
 *   3 ルールの不一致試行は「関係ない2属性のうち1つめだけ逆／2つめだけ逆／両方逆」を均等に使う。
 */
import type { Rng } from '../../engine/rng';
import { balancedCounts } from '../../engine/sequence';
import { activeRules, opposite, type Rule, type ScTrial, type Side, type Transition } from './model';

/** 1ラウンドの試行数（1試合 = 1 ラウンド） */
export const TRIALS_PER_ROUND = 30;
/**
 * 単一課題ウォームアップの試行数。毎日の試合ではウォームアップをしない（仕様書 v1.1。createWarmup は定義しない）が、
 * 混合コストを測るときのために試行列づくり（makeWarmupTrials）は残してある。
 */
export const WARMUP_TRIALS = 12;
/** 同じ構えの連続の上限 */
export const MAX_SAME_STANCE = 4;
/** ウォームアップの構え（構えA「高低」） */
export const WARMUP_RULE: Rule = 'height';

export interface Cue {
  rule: Rule;
  transition: Transition;
}

/**
 * 切替 (true) / 反復 (false) の並び。長さ n、切替はちょうど switches 個、反復の連続は maxRepeats 以下。
 * 残りの数に比例して引く（くじ引き）ので並びは一様に近いランダムになる。制約を満たせない組合せは例外。
 */
export function transitionFlags(rng: Rng, n: number, switches: number, maxRepeats: number): boolean[] {
  let sw = switches;
  let rep = n - switches;
  if (sw < 0 || rep < 0) throw new RangeError(`transitionFlags: switches=${switches} が 0..${n} の外`);
  // 反復の残り rep 個を、いまの連続 run と残りの切替 sw 個で区切られた枠に置けるか
  const feasible = (r: number, s: number, run: number): boolean => r <= maxRepeats - run + s * maxRepeats;
  if (!feasible(rep, sw, 0)) throw new RangeError('transitionFlags: 反復が多すぎて連続の上限を守れない');
  const out: boolean[] = [];
  let run = 0;
  for (let i = 0; i < n; i++) {
    const canRepeat = rep > 0 && run < maxRepeats && feasible(rep - 1, sw, run + 1);
    const canSwitch = sw > 0 && feasible(rep, sw - 1, 0);
    const isSwitch = canRepeat && canSwitch ? rng.next() * (sw + rep) < sw : canSwitch;
    out.push(isSwitch);
    if (isSwitch) {
      sw -= 1;
      run = 0;
    } else {
      rep -= 1;
      run += 1;
    }
  }
  return out;
}

/** 構えの並び（最初の試行は first、以降は switch / repeat） */
export function cueSequence(rng: Rng, n: number, rules: readonly Rule[], maxSame: number = MAX_SAME_STANCE): Cue[] {
  if (n <= 0) return [];
  const first = rng.pick(rules);
  const out: Cue[] = [{ rule: first, transition: 'first' }];
  if (rules.length < 2) {
    for (let i = 1; i < n; i++) out.push({ rule: first, transition: 'repeat' });
    return out;
  }
  const switches = balancedCounts(rng, n - 1, 2)[0] as number;
  for (const isSwitch of transitionFlags(rng, n - 1, switches, maxSame - 1)) {
    const prev = (out[out.length - 1] as Cue).rule;
    const rule = isSwitch ? rng.pick(rules.filter((r) => r !== prev)) : prev;
    out.push({ rule, transition: isSwitch ? 'switch' : 'repeat' });
  }
  return out;
}

/**
 * 層（keys が同じ試行）ごとに偏りなく2値を割り当てる。
 * 層をキーの辞書順に並べ、層の中はシャッフルし、その順に a, b, a, b … と交互に配る（開始はランダム）。
 * 並べた列のどの連続区間でも2値の差は 1 以下なので、各層・キーの前方一致でまとめた層・全体のどれでも差は 1 以下。
 */
export function stratifiedAlternate<V>(rng: Rng, keys: readonly string[], values: readonly [V, V]): V[] {
  const groups = new Map<string, number[]>();
  keys.forEach((k, i) => {
    const g = groups.get(k);
    if (g) g.push(i);
    else groups.set(k, [i]);
  });
  const order: number[] = [];
  for (const k of [...groups.keys()].sort()) order.push(...rng.shuffle(groups.get(k) as number[]));
  const start = rng.int(0, 2);
  const out = new Array<V>(keys.length);
  order.forEach((idx, j) => {
    out[idx] = values[(start + j) % 2] as V;
  });
  return out;
}

/** 3 ルールの不一致試行の型: 0 = 関係ない属性の1つめだけ逆、1 = 2つめだけ逆、2 = 両方逆 */
type IncongruentPattern = 0 | 1 | 2;

function buildTrial(
  cue: Cue,
  side: Side,
  congruent: boolean,
  dims: readonly Rule[],
  pattern: IncongruentPattern,
  untrained: boolean,
): ScTrial {
  const values: Record<Rule, Side | null> = { height: null, color: null, shape: null };
  values[cue.rule] = side;
  const others = dims.filter((d) => d !== cue.rule);
  if (congruent) {
    for (const d of others) values[d] = side;
  } else if (others.length === 1) {
    values[others[0] as Rule] = opposite(side);
  } else {
    values[others[0] as Rule] = pattern === 1 ? side : opposite(side);
    values[others[1] as Rule] = pattern === 0 ? side : opposite(side);
  }
  return {
    rule: cue.rule,
    transition: cue.transition,
    height: values.height ?? side,
    color: values.color ?? side,
    shape: dims.includes('shape') ? values.shape : null,
    congruent,
    untrained,
  };
}

/** 構えの並びから試行列を作る（一致・不一致、左右、3 ルールの不一致の型を割り当てる） */
export function trialsFromCues(rng: Rng, cues: readonly Cue[], rules: number, untrained: boolean): ScTrial[] {
  const dims = activeRules(rules);
  const congruent = stratifiedAlternate<boolean>(
    rng,
    cues.map((c) => `${c.transition}|${c.rule}`),
    [true, false],
  );
  const sides = stratifiedAlternate<Side>(
    rng,
    cues.map((c, i) => `${c.transition}|${c.rule}|${congruent[i] ? 'c' : 'i'}`),
    ['left', 'right'],
  );
  // 3 ルールの不一致試行: 3つの型を均等に（端数はランダム）配ってシャッフル
  const incongruent = cues.map((_, i) => i).filter((i) => !congruent[i]);
  const patterns: IncongruentPattern[] = [];
  if (dims.length >= 3) {
    balancedCounts(rng, incongruent.length, 3).forEach((c, p) => {
      for (let k = 0; k < c; k++) patterns.push(p as IncongruentPattern);
    });
  }
  const shuffled = rng.shuffle(patterns);
  const patternOf = new Map<number, IncongruentPattern>();
  incongruent.forEach((idx, k) => patternOf.set(idx, shuffled[k] ?? 0));
  return cues.map((cue, i) =>
    buildTrial(cue, sides[i] as Side, congruent[i] as boolean, dims, patternOf.get(i) ?? 0, untrained),
  );
}

/** 訓練ラウンド（混合ブロック）の試行列 */
export function makeRoundTrials(rng: Rng, rules: number, untrained: boolean, n: number = TRIALS_PER_ROUND): ScTrial[] {
  return trialsFromCues(rng, cueSequence(rng, n, activeRules(rules)), rules, untrained);
}

/** 単一課題ウォームアップ（切替なし・構えA のみ）の試行列。毎日の試合では使わない（測定用） */
export function makeWarmupTrials(rng: Rng, rules: number, untrained: boolean, n: number = WARMUP_TRIALS): ScTrial[] {
  const cues: Cue[] = Array.from({ length: n }, () => ({ rule: WARMUP_RULE, transition: 'single' as const }));
  return trialsFromCues(rng, cues, rules, untrained);
}
