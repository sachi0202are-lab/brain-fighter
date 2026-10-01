import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../engine/rng';
import { maxRunLength } from '../../engine/sequence';
import { game } from './index';
import { ladderParams } from './ladder';
import { activeRules, correctSide, type ScTrial, type Side } from './model';
import {
  cueSequence,
  everyRuleAppears,
  makeRoundTrials,
  MIN_PER_RULE,
  stratifiedAlternate,
  transitionFlags,
  TRIALS_PER_ROUND,
} from './sequence';

const OPTS = { untrained: false, surface: 0, roundNo: 1, kind: 'round' as const };
const SEEDS = Array.from({ length: 300 }, (_, i) => 1000 + i);

function rounds(rules: number): ScTrial[][] {
  return SEEDS.map((s) => makeRoundTrials(mulberry32(s), rules, false));
}

/** 全試行の中で、その属性が左の値（上段／橙／丸）だった割合 */
function leftShare(all: ScTrial[], key: 'height' | 'color' | 'shape'): number {
  const xs = all.filter((t) => t[key] !== null);
  return xs.filter((t) => t[key] === 'left').length / xs.length;
}

describe.each([2, 3])('訓練ラウンドの系列（%i ルール）', (rules) => {
  const all = rounds(rules);
  const flat = all.flat();

  it('1ラウンド 16 試行（仕様書 v1.3）。最初の試行は first、以降は switch / repeat', () => {
    for (const r of all) {
      expect(r).toHaveLength(TRIALS_PER_ROUND);
      expect(r[0]!.transition).toBe('first');
      for (let i = 1; i < r.length; i++) {
        const t = r[i]!;
        expect(t.transition).toBe(t.rule === r[i - 1]!.rule ? 'repeat' : 'switch');
      }
    }
  });

  it('切替率 50%（15 回の移り変わりのうち切替は 7 か 8）', () => {
    let switches = 0;
    for (const r of all) {
      const n = r.filter((t) => t.transition === 'switch').length;
      expect(n === 7 || n === 8).toBe(true);
      switches += n;
    }
    expect(switches / (all.length * 15)).toBeCloseTo(0.5, 2);
  });

  it('同じ構えの連続は 4 回まで（5 連続は無い）。4 連続は実際に起きる（上限だけで型は作らない）', () => {
    let saw4 = 0;
    for (const r of all) {
      const run = maxRunLength(r.map((t) => t.rule));
      expect(run).toBeLessThanOrEqual(4);
      if (run === 4) saw4 += 1;
    }
    expect(saw4).toBeGreaterThan(0);
  });

  it('切替の並びは乱数（交互や固定の型にならない）', () => {
    // 15 回の移り変わりの並びは約 1 万通りなので、300 ラウンドでたまたま同じ並びになることは数回ある
    const patterns = new Set(all.map((r) => r.map((t) => (t.transition === 'switch' ? 's' : 'r')).join('')));
    expect(patterns.size).toBeGreaterThan(all.length * 0.9);
    // 切替の連続は上限を設けていないので、長い連続も時々ある
    const longSwitchRuns = all.filter((r) => maxRunLength(r.slice(1).map((t) => t.transition)) >= 5).length;
    expect(longSwitchRuns).toBeGreaterThan(0);
  });

  it('一致と不一致は 50/50（1ラウンド 8/8）、切替・反復それぞれの中でも差は 1 以下', () => {
    for (const r of all) {
      expect(r.filter((t) => t.congruent).length).toBe(8);
      for (const tr of ['switch', 'repeat'] as const) {
        const xs = r.filter((t) => t.transition === tr);
        const c = xs.filter((t) => t.congruent).length;
        expect(Math.abs(c - (xs.length - c))).toBeLessThanOrEqual(1);
      }
    }
  });

  it('一致試行はどの判断軸でも同じ応答、不一致試行は少なくとも1つの判断軸で応答が分かれる', () => {
    const dims = activeRules(rules);
    for (const t of flat) {
      const answers = new Set(dims.map((d) => t[d]));
      expect(answers.size === 1).toBe(t.congruent);
      expect(correctSide(t)).toBe(t[t.rule]);
    }
  });

  it('正解の左右は 50/50（1ラウンド 8/8）', () => {
    for (const r of all) expect(r.filter((t) => correctSide(t) === 'left').length).toBe(8);
  });

  it('属性はそれぞれ 50%（±2%）', () => {
    expect(leftShare(flat, 'height')).toBeCloseTo(0.5, 1);
    expect(Math.abs(leftShare(flat, 'height') - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(leftShare(flat, 'color') - 0.5)).toBeLessThan(0.02);
    if (rules === 3) expect(Math.abs(leftShare(flat, 'shape') - 0.5)).toBeLessThan(0.02);
  });

  it(`形は ${rules === 2 ? '2 ルールでは変わらない（null）' : '3 ルールで丸／角が出る'}`, () => {
    if (rules === 2) expect(flat.every((t) => t.shape === null)).toBe(true);
    else expect(new Set(flat.map((t) => t.shape))).toEqual(new Set(['left', 'right']));
  });

  it('構えはどれも出る（3 ルールでは 3 つがほぼ均等）', () => {
    const dims = activeRules(rules);
    for (const d of dims) {
      const share = flat.filter((t) => t.rule === d).length / flat.length;
      expect(Math.abs(share - 1 / dims.length)).toBeLessThan(0.03);
    }
  });

  it(`どの構えも 1 ラウンドに ${MIN_PER_RULE} 回以上出る${rules === 3 ? '（仕様書 v1.3: 3 ルールでは満たすまで引き直す）' : ''}`, () => {
    for (const r of all) {
      const counts = activeRules(rules).map((d) => r.filter((t) => t.rule === d).length);
      expect(Math.min(...counts)).toBeGreaterThanOrEqual(MIN_PER_RULE);
    }
  });

  if (rules === 3) {
    it('3 ルールの不一致は「1つだけ逆」「両方逆」の型が均等（各 1/3 ± 3%）', () => {
      const inc = flat.filter((t) => !t.congruent);
      const flipped = inc.map((t) => activeRules(3).filter((d) => d !== t.rule && t[d] !== t[t.rule]).length);
      const both = flipped.filter((k) => k === 2).length / inc.length;
      expect(Math.abs(both - 1 / 3)).toBeLessThan(0.03);
      expect(flipped.every((k) => k >= 1)).toBe(true);
    });
  }
});

describe('3 ルールの引き直し（仕様書 v1.3: 各構えが 1 ラウンドに 2 回以上出るよう引き直す）', () => {
  const rules3 = activeRules(3);

  it('引き直さないと 2 回未満の構えが出るラウンドがあり、引き直すと無くなる（切替率・連続の上限はそのまま）', () => {
    let short = 0;
    for (const s of SEEDS) {
      // minPerRule = 0 なら引き直さない（1 回目の並びそのもの）
      const raw = cueSequence(mulberry32(s), TRIALS_PER_ROUND, rules3, 4, 0);
      if (!everyRuleAppears(raw, rules3, MIN_PER_RULE)) short += 1;
      const cues = cueSequence(mulberry32(s), TRIALS_PER_ROUND, rules3);
      expect(everyRuleAppears(cues, rules3, MIN_PER_RULE)).toBe(true);
      const sw = cues.filter((c) => c.transition === 'switch').length;
      expect(sw === 7 || sw === 8).toBe(true);
      expect(maxRunLength(cues.map((c) => c.rule))).toBeLessThanOrEqual(4);
    }
    expect(short).toBeGreaterThan(0);
  });

  it('2 ルールは引き直さなくても満たす（切替が 7 回以上あるので両方の構えが出る）', () => {
    for (const s of SEEDS) {
      const cues = cueSequence(mulberry32(s), TRIALS_PER_ROUND, activeRules(2), 4, 0);
      expect(everyRuleAppears(cues, activeRules(2), MIN_PER_RULE)).toBe(true);
    }
  });

  it('ウォームアップ（単一課題）は無い（仕様書 v1.1）', () => {
    expect(game.createWarmup).toBeUndefined();
  });
});

describe('系列づくりの部品', () => {
  it('同じシードなら同じ系列（乱数は rng だけ）', () => {
    expect(game.createRound(ladderParams(4), mulberry32(9), OPTS)).toEqual(game.createRound(ladderParams(4), mulberry32(9), OPTS));
    expect(game.createRound(ladderParams(4), mulberry32(9), OPTS)).not.toEqual(game.createRound(ladderParams(4), mulberry32(10), OPTS));
  });

  it('createRound は難度のルール数を使う（ステップではなく）。未訓練の印が付く', () => {
    const t2 = game.createRound({ step: 15, rules: 2, D: 1000, CSI: 400 }, mulberry32(1), OPTS);
    expect(t2.every((t) => t.shape === null && t.rule !== 'shape')).toBe(true);
    const t3 = game.createRound({ step: 1, rules: 3, D: 1400, CSI: 500 }, mulberry32(1), { ...OPTS, untrained: true });
    expect(t3.some((t) => t.rule === 'shape')).toBe(true);
    expect(t3.every((t) => t.untrained)).toBe(true);
  });

  it('transitionFlags: 切替の数ちょうど、反復の連続は上限以下', () => {
    for (const s of SEEDS.slice(0, 100)) {
      const f = transitionFlags(mulberry32(s), 15, 7, 3);
      expect(f).toHaveLength(15);
      expect(f.filter(Boolean)).toHaveLength(7);
      let run = 0;
      for (const sw of f) {
        run = sw ? 0 : run + 1;
        expect(run).toBeLessThanOrEqual(3);
      }
    }
    // 上限ぎりぎりの組合せ（反復 9 を 切替 2 で区切る = 3 + 3 + 3）
    const tight = transitionFlags(mulberry32(1), 11, 2, 3);
    expect(tight.map((x) => (x ? 's' : 'r')).join('')).toBe('rrrsrrrsrrr');
    expect(() => transitionFlags(mulberry32(1), 12, 2, 3)).toThrow(RangeError);
  });

  it('cueSequence: 1ルールなら反復だけ、長さ 0 なら空', () => {
    expect(cueSequence(mulberry32(1), 0, ['height', 'color'])).toEqual([]);
    const one = cueSequence(mulberry32(1), 5, ['color']);
    expect(one.map((c) => c.transition)).toEqual(['first', 'repeat', 'repeat', 'repeat', 'repeat']);
  });

  it('stratifiedAlternate: 層ごと・全体で2値の差が 1 以下', () => {
    const keys = ['a', 'b', 'a', 'c', 'b', 'a', 'a', 'c', 'b', 'b', 'a'];
    for (const s of SEEDS.slice(0, 50)) {
      const v = stratifiedAlternate<Side>(mulberry32(s), keys, ['left', 'right']);
      const diff = (idx: number[]): number => Math.abs(idx.filter((i) => v[i] === 'left').length * 2 - idx.length);
      expect(diff(keys.map((_, i) => i))).toBeLessThanOrEqual(1);
      for (const k of ['a', 'b', 'c']) expect(diff(keys.flatMap((kk, i) => (kk === k ? [i] : [])))).toBeLessThanOrEqual(1);
    }
  });
});
