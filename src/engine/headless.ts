/**
 * ヘッドレス実行（仮想時計）。Vitest から GameModule をブラウザ無しで最後まで動かすための道具。
 * フェーズ2の担当者も自分のゲームのテストに使ってよい。
 */
import { botPlan, type AnswerPlan } from './autoplay';
import { runMatch, type MatchConfig, type MatchResult, type RoundDone } from './match';
import { RoundRunner, type RoundEvent, type StimulusSurface } from './round';
import { hashSeed } from './rng';
import { DEFAULT_FRAME_MS, VirtualScheduler } from './timing';
import type { GameModule, Params, Response, ResponseLayout, RoundOptions, RoundSummary } from './types';

export interface HeadlessOptions {
  /** フレーム間隔（既定 60Hz） */
  frameMs?: number;
  /** 各試行で押すボタン（[] なら押さない）。既定は 5 試行に1回誤る疑似プレイヤー */
  plan?: (ctx: { i: number; expected: Response | null; layout: ResponseLayout }) => AnswerPlan;
  /** 応答窓が開いてから押すまで (ms)。既定 200 */
  delayMs?: number | ((i: number) => number);
  /** イベントの購読（演出の代わりなど） */
  onEvent?: (e: RoundEvent) => void;
  /** 描画先（renderStimulus を通したいとき） */
  surface?: StimulusSurface | null;
  /** 暴走防止（既定 60 分ぶんのフレーム） */
  maxFrames?: number;
}

export async function runRoundHeadless<P extends Params, T>(
  game: GameModule<P, T>,
  trials: readonly T[],
  params: P,
  options: RoundOptions,
  adaptive: boolean,
  opts: HeadlessOptions = {},
): Promise<RoundSummary<P, T>> {
  const sched = new VirtualScheduler(opts.frameMs ?? DEFAULT_FRAME_MS);
  const runner = new RoundRunner<P, T>({
    game,
    trials,
    params,
    options,
    adaptive,
    scheduler: sched,
    surface: opts.surface ?? null,
  });
  if (opts.onEvent) runner.events.onAny(opts.onEvent);
  return driveRunner(runner, sched, opts);
}

/**
 * 作成済みの RoundRunner を仮想時計で最後まで動かす（疑似プレイヤーが応答する）。
 * 画面と同じように自分で RoundRunner を作り、演出を購読させてから動かしたいときに使う。
 */
export async function driveRunner<P extends Params, T>(
  runner: RoundRunner<P, T>,
  sched: VirtualScheduler,
  opts: Pick<HeadlessOptions, 'plan' | 'delayMs' | 'maxFrames'> = {},
): Promise<RoundSummary<P, T>> {
  const plan = opts.plan ?? ((c) => botPlan(c.i, c.layout, c.expected));
  const delayOf = (i: number): number =>
    typeof opts.delayMs === 'function' ? opts.delayMs(i) : (opts.delayMs ?? 200);
  const promise = runner.start();
  let decided = -1;
  let pending: { i: number; at: number; ids: AnswerPlan } | null = null;
  const maxFrames = opts.maxFrames ?? Math.ceil((60 * 60 * 1000) / sched.frameMs);
  for (let f = 0; f < maxFrames && !runner.done; f++) {
    sched.step();
    const snap = runner.snapshot();
    if (!snap || !snap.accepting) continue;
    if (decided !== snap.i) {
      decided = snap.i;
      const ids = plan({ i: snap.i, expected: snap.expected, layout: runner.layout });
      pending = ids.length > 0 ? { i: snap.i, at: sched.now() + delayOf(snap.i), ids } : null;
    }
    if (pending && pending.i === snap.i && sched.now() >= pending.at - 1e-9) {
      for (const id of pending.ids) runner.input(id, sched.now());
      pending = null;
    }
  }
  if (!runner.done) {
    runner.abort();
    promise.catch(() => {});
    throw new Error(`ヘッドレス実行が ${maxFrames} フレームで終わりませんでした`);
  }
  return promise;
}

/** 1試合をヘッドレスで最後まで動かす（ラウンド間の待ちは無し） */
export async function runMatchHeadless<P extends Params, T>(
  game: GameModule<P, T>,
  params: P,
  cfg: Partial<Omit<MatchConfig<P, T>, 'game' | 'params'>> & { seed: number },
  opts: HeadlessOptions & { onRoundDone?: (d: RoundDone<P, T>) => void; extra?: boolean } = {},
): Promise<MatchResult<P, T>> {
  return runMatch<P, T>(
    {
      game,
      params,
      surface: cfg.surface ?? 0,
      previousPower: cfg.previousPower ?? 0,
      seedFor: cfg.seedFor ?? ((kind, roundNo) => hashSeed(cfg.seed, game.id, kind, roundNo)),
      ...(cfg.untrained !== undefined ? { untrained: cfg.untrained } : {}),
      ...(cfg.adaptive !== undefined ? { adaptive: cfg.adaptive } : {}),
      ...(cfg.warmup !== undefined ? { warmup: cfg.warmup } : {}),
      ...(cfg.rounds !== undefined ? { rounds: cfg.rounds } : {}),
      ...(cfg.allowExtra !== undefined ? { allowExtra: cfg.allowExtra } : {}),
    },
    {
      runRound: (req) => runRoundHeadless(game, req.trials, req.params, req.options, req.adaptive, opts),
      onRoundDone: (d) => opts.onRoundDone?.(d),
      askExtra: async () => opts.extra === true,
    },
  );
}
