/**
 * 1試合（= 1ゲームの1セッション分）の進行。
 * ウォームアップ（任意）→ ラウンド × roundsPerMatch（既定 1。仕様書 v1.2）（→ 任意の追加ラウンド）。
 * 複数ラウンド・ウォームアップ・追加ラウンドの仕組みはエンジンに残してある（認定戦は 2 ラウンド）。
 * 画面（ラウンド間の演出、保存）は hooks で差し込む。ヘッドレスのテストでも同じ関数を使う。
 */
import { normalizePower } from './power';
import { mulberry32 } from './rng';
import type {
  GameModule,
  Params,
  RoundKind,
  RoundOptions,
  RoundStats,
  RoundSummary,
} from './types';

/** ラウンド1本を終えた結果（保存・表示用） */
export interface RoundDone<P extends Params = Params, T = unknown> {
  summary: RoundSummary<P, T>;
  /** 次のラウンドの難度（ラウンド単位の適応後） */
  paramsEnd: P;
  /** ラウンド末の戦闘力（0..1000 の整数）。ウォームアップは直前の値のまま */
  power: number;
  /** ゲーム固有の記録 */
  metrics: Record<string, number>;
  /** 試行列を作った乱数シード */
  seed: number;
}

/** 戦闘力の計算に渡す成績（RT を含めない） */
export function statsOf(s: RoundStats): RoundStats {
  return { trials: s.trials, correct: s.correct, accuracy: s.accuracy, errors: { ...s.errors } };
}

/** ラウンド末の処理: ラウンド単位の適応・戦闘力・固有指標 */
export function concludeRound<P extends Params, T>(
  game: GameModule<P, T>,
  summary: RoundSummary<P, T>,
  opts: { adaptive: boolean; warmup: RoundSummary<P, T> | null; previousPower: number; seed: number },
): RoundDone<P, T> {
  let metrics: Record<string, number> = {};
  try {
    metrics = game.metrics?.(summary, { warmup: opts.warmup }) ?? {};
  } catch (err) {
    console.error(`[brain-fighter] ${game.id}.metrics error`, err);
  }
  if (summary.kind === 'warmup') {
    return { summary, paramsEnd: { ...summary.paramsStart }, power: opts.previousPower, metrics, seed: opts.seed };
  }
  const paramsEnd = opts.adaptive && game.adapt ? game.adapt({ ...summary.paramsPlayed }, summary) : { ...summary.paramsPlayed };
  const power = normalizePower(game.power({ ...summary.paramsPlayed }, statsOf(summary)));
  return { summary, paramsEnd, power, metrics, seed: opts.seed };
}

/** 表層バリエーション番号（仕様書 4.4: 最初の2試合は固定、以降2試合ごとに入れ替え） */
export function surfaceIndex(matchIndex: number, surfaceCount = 1): number {
  if (surfaceCount <= 1 || matchIndex < 0) return 0;
  return Math.floor(matchIndex / 2) % surfaceCount;
}

export interface RoundRequest<P extends Params, T> {
  kind: RoundKind;
  roundNo: number;
  trials: T[];
  params: P;
  options: RoundOptions;
  seed: number;
  /** 試行単位の適応をするか */
  adaptive: boolean;
}

export interface MatchConfig<P extends Params, T> {
  game: GameModule<P, T>;
  /** 開始時の難度 */
  params: P;
  /** 認定戦の未訓練刺激セット（既定 false） */
  untrained?: boolean;
  /** 適応するか（既定 true。認定戦は false） */
  adaptive?: boolean;
  /** ウォームアップをするか（既定 true。ゲームが createWarmup を持つときだけ） */
  warmup?: boolean;
  /** ラウンド数（既定 game.roundsPerMatch ?? 1。認定戦は 2） */
  rounds?: number;
  /** 「もう1ラウンド」を出すか（既定 true） */
  allowExtra?: boolean;
  /** 表層バリエーション番号 */
  surface: number;
  /** 直前の戦闘力（ウォームアップの記録に使う） */
  previousPower: number;
  /** ラウンドごとのシード */
  seedFor(kind: RoundKind, roundNo: number): number;
}

export interface MatchHooks<P extends Params, T> {
  /** ラウンド（またはウォームアップ）を1本実行する */
  runRound(req: RoundRequest<P, T>): Promise<RoundSummary<P, T>>;
  /** ラウンドを終えるたびに（保存など） */
  onRoundDone?(done: RoundDone<P, T>): void | Promise<void>;
  /** ラウンド間（ウォームアップの後と、最後以外のラウンドの後） */
  between?(done: RoundDone<P, T>, next: { roundNo: number }): Promise<void>;
  /** 最後のラウンドの後、追加ラウンドをするか */
  askExtra?(done: RoundDone<P, T>): Promise<boolean>;
}

export interface MatchResult<P extends Params = Params, T = unknown> {
  warmup: RoundDone<P, T> | null;
  rounds: RoundDone<P, T>[];
  paramsEnd: P;
}

export async function runMatch<P extends Params, T>(
  cfg: MatchConfig<P, T>,
  hooks: MatchHooks<P, T>,
): Promise<MatchResult<P, T>> {
  const { game } = cfg;
  const adaptive = cfg.adaptive ?? true;
  const untrained = cfg.untrained ?? false;
  let planned = cfg.rounds ?? game.roundsPerMatch ?? 1;
  let extraLeft = (cfg.allowExtra ?? true) ? (game.extraRounds ?? 0) : 0;
  let params: P = { ...cfg.params };
  let previousPower = cfg.previousPower;

  let warmup: RoundDone<P, T> | null = null;
  if ((cfg.warmup ?? true) && game.createWarmup) {
    const seed = cfg.seedFor('warmup', 0);
    const options: RoundOptions = { untrained, surface: cfg.surface, roundNo: 0, kind: 'warmup' };
    const trials = game.createWarmup(params, mulberry32(seed), options);
    if (trials.length > 0) {
      const summary = await hooks.runRound({ kind: 'warmup', roundNo: 0, trials, params, options, seed, adaptive: false });
      warmup = concludeRound(game, summary, { adaptive: false, warmup: null, previousPower, seed });
      await hooks.onRoundDone?.(warmup);
      await hooks.between?.(warmup, { roundNo: 1 });
    }
  }

  const rounds: RoundDone<P, T>[] = [];
  for (let roundNo = 1; roundNo <= planned; roundNo++) {
    const seed = cfg.seedFor('round', roundNo);
    const options: RoundOptions = { untrained, surface: cfg.surface, roundNo, kind: 'round' };
    const trials = game.createRound(params, mulberry32(seed), options);
    const summary = await hooks.runRound({ kind: 'round', roundNo, trials, params, options, seed, adaptive });
    const done = concludeRound(game, summary, {
      adaptive,
      warmup: warmup?.summary ?? null,
      previousPower,
      seed,
    });
    rounds.push(done);
    previousPower = done.power;
    params = done.paramsEnd;
    await hooks.onRoundDone?.(done);
    if (roundNo < planned) {
      await hooks.between?.(done, { roundNo: roundNo + 1 });
    } else if (extraLeft > 0 && hooks.askExtra && (await hooks.askExtra(done))) {
      extraLeft -= 1;
      planned += 1;
    }
  }
  return { warmup, rounds, paramsEnd: params };
}
