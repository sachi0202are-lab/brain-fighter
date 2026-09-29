/**
 * ラウンド記録に残す固有の指標（仕様書 6.3「記録」）と、ラウンド末の一言の選び方。
 *
 * - 反応時間の中央値は「正答・応答あり」の試行だけで取り、ラウンドの最初の試行（前の構えが無い）は除く。
 * - 切替コスト = 切替試行の RT 中央値 − 反復試行の RT 中央値
 * - 混合コスト = 混合ラウンドの反復試行の RT 中央値 − ウォームアップ（単一課題）の RT 中央値
 * - 計算できない値（該当する正答が 0 件など）は入れない（記録は有限の数値だけ）。
 * どの指標も戦闘力・適応には使わない（速さはスコアに影響しない。仕様書 5.1 MUST）。
 */
import { median } from '../../engine/stats';
import type { RoundSummary, TrialResult } from '../../engine/types';
import type { ScParams, ScTrial, Transition } from './model';

type Summary = RoundSummary<ScParams, ScTrial>;
type Result = TrialResult<ScParams, ScTrial>;

/** 整数 ms に丸める（-0 は 0） */
const ms = (v: number): number => Math.round(v) || 0;
/** 割合を小数 3 桁に丸める */
const ratio = (v: number): number => Math.round(v * 1000) / 1000;

const isTransition =
  (tr: Transition) =>
  (t: ScTrial): boolean =>
    t.transition === tr;

/** 正答・応答ありの試行の RT 中央値（ラウンドの最初の試行は除く） */
export function medianRt(results: readonly Result[], pred: (t: ScTrial) => boolean): number | undefined {
  return median(
    results.filter((r) => r.i > 0 && r.correct && r.rtMs !== undefined && pred(r.trial)).map((r) => r.rtMs as number),
  );
}

/** 条件に合う試行の正答率（該当が無ければ undefined） */
export function accuracyOf(results: readonly Result[], pred: (t: ScTrial) => boolean): number | undefined {
  const xs = results.filter((r) => pred(r.trial));
  return xs.length === 0 ? undefined : xs.filter((r) => r.correct).length / xs.length;
}

/** 単一課題（ウォームアップ）の RT 中央値 */
export function singleTaskRt(warmup: Summary | null): number | undefined {
  return warmup ? medianRt(warmup.results, () => true) : undefined;
}

export function stanceMetrics(round: Summary, warmup: Summary | null): Record<string, number> {
  const out: Record<string, number> = {
    step: round.paramsPlayed.step,
    rules: round.paramsPlayed.rules,
    accuracy: ratio(round.accuracy),
  };
  if (round.kind === 'warmup') {
    const single = singleTaskRt(round);
    if (single !== undefined) out.rtSingle = ms(single);
    return out;
  }
  const isRepeat = isTransition('repeat');
  const isSwitch = isTransition('switch');
  const accRepeat = accuracyOf(round.results, isRepeat);
  const accSwitch = accuracyOf(round.results, isSwitch);
  if (accRepeat !== undefined) out.accRepeat = ratio(accRepeat);
  if (accSwitch !== undefined) out.accSwitch = ratio(accSwitch);
  const rep = medianRt(round.results, isRepeat);
  const sw = medianRt(round.results, isSwitch);
  if (rep !== undefined) out.rtRepeat = ms(rep);
  if (sw !== undefined) out.rtSwitch = ms(sw);
  if (rep !== undefined && sw !== undefined) out.switchCost = ms(sw - rep);
  const single = singleTaskRt(warmup);
  if (single !== undefined) {
    out.rtSingle = ms(single);
    if (rep !== undefined) out.mixingCost = ms(rep - single);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ラウンド末の一言（方略・努力に向ける。能力ラベルは使わない）
// ---------------------------------------------------------------------------

export type TipKey = 'kept' | 'timeout' | 'switch' | 'repeat' | 'conflict' | 'generic';

/**
 * そのラウンドの傾向から一言の種類を選ぶ（上から順に最初に当てはまるもの）。
 * 1. 正答率 90% 以上 → kept（切り替えても正答率を保てた）
 * 2. 時間切れが 3 回以上で、押し間違いより多い → timeout
 * 3. 切替試行の誤り率が反復試行より 10 ポイント以上高い → switch（「切替の直後は 0.2 秒待つ」）
 * 4. 反復試行の誤り率が切替試行より 10 ポイント以上高い → repeat
 * 5. 押し間違いの多く（3 回以上・一致試行の 3 倍以上）が不一致試行 → conflict（もう一方の基準につられた）
 * 6. それ以外 → generic（ラウンド番号で順に）
 */
export function tipKey(round: Summary): TipKey {
  if (round.accuracy + 1e-9 >= 0.9) return 'kept';
  const timeouts = round.results.filter((r) => !r.correct && r.response === null).length;
  const wrong = round.results.filter((r) => !r.correct && r.response !== null);
  if (timeouts >= 3 && timeouts > wrong.length) return 'timeout';
  const errRate = (tr: Transition): number => 1 - (accuracyOf(round.results, isTransition(tr)) ?? 1);
  const sw = errRate('switch');
  const rep = errRate('repeat');
  if (sw >= rep + 0.1) return 'switch';
  if (rep >= sw + 0.1) return 'repeat';
  const wrongIncongruent = wrong.filter((r) => !r.trial.congruent).length;
  const wrongCongruent = wrong.length - wrongIncongruent;
  if (wrongIncongruent >= 3 && wrongIncongruent >= 3 * wrongCongruent) return 'conflict';
  return 'generic';
}
