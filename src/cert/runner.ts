/**
 * 認定戦の実行（固定難度・2 ラウンド）。
 *
 * エンジンの既存の部品だけで作っている: 試行列は GameModule.createRound、ラウンドの実行は runRound フック
 * （画面では RoundRunner、テストではヘッドレス）に `adaptive: false` で渡す。
 * - 試行単位の適応（adaptTrial）は RoundRunner が adaptive = false のとき呼ばない。
 * - ラウンド単位の適応（adapt）と戦闘力（power）はここでは呼ばない（runMatch / concludeRound を通さない）。
 *   → 2 ラウンドとも certParams(tier) そのままの難度で、戦闘力にも数えない。
 * - ウォームアップ・「もう1ラウンド」は無い。未訓練の刺激セット（untrained: true）を使う。
 */
import { statsOf, type RoundRequest } from '../engine/match';
import { mulberry32 } from '../engine/rng';
import { certRoundPassed, type GameModule, type Params, type RoundOptions, type RoundSummary } from '../engine/types';
import { CERT_ROUNDS, judgeCert, type CertVerdict } from './cert';

export interface CertRunConfig<P extends Params, T> {
  game: GameModule<P, T>;
  /** 受けるティア（現在のベルト + 1） */
  tier: number;
  /** ラウンドごとのシード */
  seedFor(roundNo: number): number;
}

export interface CertRunHooks<P extends Params, T> {
  /** ラウンドを1本実行する（req.adaptive は常に false） */
  runRound(req: RoundRequest<P, T>): Promise<RoundSummary<P, T>>;
  /** ラウンドを終えるたびに（記録など） */
  onRoundDone?(summary: RoundSummary<P, T>, info: { roundNo: number; passed: boolean }): void | Promise<void>;
  /** ラウンド間（最後のラウンドの後には呼ばない） */
  between?(summary: RoundSummary<P, T>, next: { roundNo: number }): Promise<void>;
}

export interface CertRunResult<P extends Params = Params, T = unknown> {
  tier: number;
  /** 審査の固定難度 */
  params: P;
  rounds: RoundSummary<P, T>[];
  verdict: CertVerdict;
}

/** 審査の固定難度（ゲームの certParams を写したもの。呼ぶたびに新しいオブジェクト） */
export function certParamsOf<P extends Params>(game: GameModule<P, unknown>, tier: number): P {
  return { ...game.certParams(tier) };
}

/** 審査のラウンドのオプション（未訓練の刺激セット・表層は 0） */
export function certRoundOptions(roundNo: number): RoundOptions {
  return { untrained: true, surface: 0, roundNo, kind: 'round' };
}

/**
 * 審査のラウンドのルールの一言（ゲームが roundIntro を持つときだけ）。
 * 固定難度と `untrained: true` を渡す（未訓練セットの呼び名で説明するゲームがある）。
 */
export function certRoundIntro<P extends Params>(game: GameModule<P, unknown>, tier: number, roundNo: number): string | undefined {
  return game.roundIntro?.(certParamsOf(game, tier), { kind: 'round', roundNo, untrained: true });
}

export async function runCert<P extends Params, T>(
  cfg: CertRunConfig<P, T>,
  hooks: CertRunHooks<P, T>,
): Promise<CertRunResult<P, T>> {
  const { game, tier } = cfg;
  const params = certParamsOf(game, tier);
  const rounds: RoundSummary<P, T>[] = [];
  for (let roundNo = 1; roundNo <= CERT_ROUNDS; roundNo++) {
    const seed = cfg.seedFor(roundNo);
    const options = certRoundOptions(roundNo);
    // どの関数にも毎回コピーを渡す（ゲーム側が書き換えても次のラウンドの難度に響かない）
    const trials = game.createRound({ ...params }, mulberry32(seed), options);
    const summary = await hooks.runRound({
      kind: 'round',
      roundNo,
      trials,
      params: { ...params },
      options,
      seed,
      adaptive: false,
    });
    rounds.push(summary);
    await hooks.onRoundDone?.(summary, { roundNo, passed: certRoundPassed(game, statsOf(summary), tier) });
    if (roundNo < CERT_ROUNDS) await hooks.between?.(summary, { roundNo: roundNo + 1 });
  }
  return { tier, params: { ...params }, rounds, verdict: judgeCert(game, tier, rounds.map(statsOf)) };
}
