/**
 * 試行列づくり（仕様書 6.3「系列」）。乱数は渡された rng だけを使う。
 *
 * 1 ラウンド 16 試行（ユーザーのフィードバックで 30 → 16）。長さは偶数にして、次の制約がどれも端数なしで成り立つようにしてある。
 * - 構えの切替率 50%・完全ランダム。同じ構えの連続は 4 回まで（= 反復の連続は 3 回まで）。
 *   ラウンド最初の試行は前が無いので切替にも反復にも数えない。残り 15 回の移り変わりのうち
 *   切替を 7 か 8（どちらかはランダム）にして、並びは乱数で決める（交互や AABB のような型は作らない）。
 *   3 ルールでは、切替先を残り2つの構えから等確率で選ぶ。ただし 3 つの構えがどれも 1 ラウンドに 2 回以上出るよう、
 *   満たさなければ構えの割り当て（最初の構えと切替先）だけを引き直す（切替の数と並びは変えない。MIN_EACH_STANCE）。
 * - 一致試行（どの判断軸で答えても同じ応答）と不一致試行を 50/50（16 試行で 8/8 ちょうど）。正解の左右も 50/50（8/8）。
 *   切替／反復 × 構えの組ごとに偏らないよう、層ごとに交互に割り当ててから並びをランダムにする。
 * - 属性（高さ・色・形）はそれぞれ 50%（正解の左右が 50/50 で、一致・不一致を左右と独立に決めるため）。
 *   3 ルールの不一致試行は「関係ない2属性のうち1つめだけ逆／2つめだけ逆／両方逆」を均等に使う（8 試行なら 3・3・2）。
 */
import type { Rng } from '../../engine/rng';
import { balancedCounts } from '../../engine/sequence';
import { activeRules, opposite, type Rule, type ScTrial, type Side, type Transition } from './model';

/**
 * 1ラウンドの試行数（1試合 = 1 ラウンド）。ユーザーのフィードバック（「1ラウンドがまだ長い。半分ぐらいでいい」）で 30 → 16。
 * 偶数にしておく: 一致／不一致と正解の左右は交互に配る（stratifiedAlternate）ので、偶数なら 8/8 ちょうどになる。
 * 移り変わりは 15 回で、切替は 7 か 8（balancedCounts）。同じ構えの連続 4 回までは 15 回でも十分に守れる。
 */
export const TRIALS_PER_ROUND = 16;
/**
 * 単一課題ウォームアップの試行数。毎日の試合ではウォームアップをしない（仕様書 v1.1。createWarmup は定義しない）が、
 * 混合コストを測るときのために試行列づくり（makeWarmupTrials）は残してある。
 */
export const WARMUP_TRIALS = 12;
/** 同じ構えの連続の上限 */
export const MAX_SAME_STANCE = 4;
/**
 * 3 ルールのとき、どの構えも 1 ラウンドにこの回数以上出す。16 試行だと、切替先を等確率で選ぶだけでは
 * 構えが 1 回も出ないラウンドが約 1.3%、1 回しか出ないラウンドが約 7.8% ある（30 試行ではそれぞれ 0.01%・0.14%）。
 * 2 ルールは切替が 7〜8 回あって構えが交互に入れ替わるので、16 試行でも各構え 4 回以上になる（引き直し不要）。
 */
export const MIN_EACH_STANCE = 2;
/**
 * 構えの割り当てを引き直す上限。16 試行・3 ルールでは、どの切替の並びでも 1 回で満たす確率が 8 割以上
 * （全 8,773 通りの並びで確かめた）なので、実際には 1〜2 回で決まる。上限まで満たせないとき（試行数が少なすぎる等）は、
 * いちばん偏りの小さかった割り当てを使う。
 */
const MAX_ASSIGN_ATTEMPTS = 64;
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

/** 切替の並び（flags）に構えを割り当てる。最初の構えは first、切替先は直前以外の構えから等確率 */
function assignRules(rng: Rng, first: Rule, flags: readonly boolean[], rules: readonly Rule[]): Cue[] {
  const out: Cue[] = [{ rule: first, transition: 'first' }];
  for (const isSwitch of flags) {
    const prev = (out[out.length - 1] as Cue).rule;
    const rule = isSwitch ? rng.pick(rules.filter((r) => r !== prev)) : prev;
    out.push({ rule, transition: isSwitch ? 'switch' : 'repeat' });
  }
  return out;
}

/** いちばん少ない構えの回数 */
function leastStanceCount(cues: readonly Cue[], rules: readonly Rule[]): number {
  return Math.min(...rules.map((r) => cues.filter((c) => c.rule === r).length));
}

/**
 * 構えの並び（最初の試行は first、以降は switch / repeat）。
 * minEach: どの構えもこの回数以上出す（既定は 3 ルール以上で MIN_EACH_STANCE、2 ルールでは 0 = 制約なし）。
 * 満たさないときは、切替の数と並びはそのままで、最初の構えと切替先だけを引き直す。
 */
export function cueSequence(
  rng: Rng,
  n: number,
  rules: readonly Rule[],
  maxSame: number = MAX_SAME_STANCE,
  minEach: number = rules.length >= 3 ? MIN_EACH_STANCE : 0,
): Cue[] {
  if (n <= 0) return [];
  const first = rng.pick(rules);
  if (rules.length < 2) {
    const out: Cue[] = [{ rule: first, transition: 'first' }];
    for (let i = 1; i < n; i++) out.push({ rule: first, transition: 'repeat' });
    return out;
  }
  const switches = balancedCounts(rng, n - 1, 2)[0] as number;
  const flags = transitionFlags(rng, n - 1, switches, maxSame - 1);
  let best = assignRules(rng, first, flags, rules);
  let bestLeast = leastStanceCount(best, rules);
  for (let attempt = 1; attempt < MAX_ASSIGN_ATTEMPTS && bestLeast < minEach; attempt++) {
    const cues = assignRules(rng, rng.pick(rules), flags, rules);
    const least = leastStanceCount(cues, rules);
    if (least > bestLeast) {
      best = cues;
      bestLeast = least;
    }
  }
  return best;
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
