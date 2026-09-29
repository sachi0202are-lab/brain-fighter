/**
 * ラウンド実行のステートマシン（ゲーム共通）。
 *
 * GameModule を受け取り、試行を順に提示し、入力を判定し、試行ログと RoundSummary を返す。
 *
 * 演出プリセット（off/light/full）との関係（仕様書 9.1 MUST）
 * - このファイルは演出を一切知らない。演出は `runner.events`（購読専用）でイベントを受け取るだけ。
 * - 試行数・提示時間・刺激間隔・応答期限・標的比率を決めるのは、試行列（createRound）・
 *   フェーズ列（phases）・難度（params）・フレーム間隔だけ。どれも演出の影響を受けない。
 */
import { Emitter, type EventSource } from './events';
import { median } from './stats';
import { quantizeMs, type FrameScheduler } from './timing';
import {
  layoutGroups,
  type GameModule,
  type Judgement,
  type Params,
  type PhaseName,
  type PhaseTiming,
  type RenderView,
  type Response,
  type ResponseLayout,
  type RoundKind,
  type RoundOptions,
  type RoundSummary,
  type TrialResult,
} from './types';

/** ラウンド実行が出すイベント（atMs はラウンド開始からの ms） */
export type RoundEvent =
  | { type: 'roundStart'; kind: RoundKind; roundNo: number; trials: number; atMs: number }
  | { type: 'trialStart'; i: number; atMs: number }
  | { type: 'phase'; i: number; phase: PhaseName; input: boolean; plannedMs: number; atMs: number }
  | { type: 'selection'; i: number; group: string; id: string; atMs: number }
  | {
      type: 'judged';
      i: number;
      correct: boolean;
      kind?: string;
      /** 判定後の連続正答数 */
      combo: number;
      /** 次の刺激までに残っている予定時間（1 ビットフィードバックはこれより短く出す） */
      feedbackMaxMs: number;
      atMs: number;
    }
  | { type: 'roundEnd'; trials: number; correct: number; maxCombo: number; atMs: number };

/** 刺激領域の描画先 */
export interface StimulusSurface {
  /** 描画の準備（変換行列のリセット・背景の塗りつぶし）をして ctx と一辺 (CSS px) を返す */
  begin(): { ctx: CanvasRenderingContext2D; size: number } | null;
}

export interface RoundRunnerConfig<P extends Params, T> {
  game: GameModule<P, T>;
  trials: readonly T[];
  params: P;
  options: RoundOptions;
  /** 試行単位の適応（adaptTrial）を行うか。ウォームアップ・認定戦では false */
  adaptive: boolean;
  scheduler: FrameScheduler;
  /** 描画先（ヘッドレス実行では null） */
  surface?: StimulusSurface | null;
  colorSafe?: boolean;
}

/** テスト用の現在状態 */
export interface RunnerSnapshot {
  kind: RoundKind;
  roundNo: number;
  trials: number;
  i: number;
  phase: PhaseName;
  /** いま応答を受け付けているか */
  accepting: boolean;
  /** この試行の応答が完成済みか */
  answered: boolean;
  expected: Response | null;
  selection: Response;
}

export class RoundAborted extends Error {
  constructor() {
    super('round aborted');
    this.name = 'RoundAborted';
  }
}

interface PlannedPhase {
  name: PhaseName;
  plannedMs: number;
  frames: number;
  input: boolean;
  untilResponse: boolean;
}

interface TrialState<P, T> {
  i: number;
  trial: T;
  params: P;
  phases: PlannedPhase[];
  timings: PhaseTiming[];
  phaseIdx: number;
  phaseStartT: number;
  anchorIdx: number;
  stimOnsetT?: number;
  selection: Record<string, string>;
  complete: boolean;
  completeT?: number;
  judgement?: Judgement;
}

export class RoundRunner<P extends Params, T> {
  private readonly emitter = new Emitter<RoundEvent>();
  /** 購読専用のイベント窓口（演出はこれだけを使う） */
  readonly events: EventSource<RoundEvent> = this.emitter;
  readonly layout: ResponseLayout;

  private readonly cfg: RoundRunnerConfig<P, T>;
  private readonly frameMs: number;
  private readonly groups: string[];
  private readonly buttonGroup = new Map<string, string>();
  private params: P;
  private roundStartT: number | null = null;
  private state: TrialState<P, T> | null = null;
  private readonly results: TrialResult<P, T>[] = [];
  private combo = 0;
  private maxCombo = 0;
  private handle: number | null = null;
  private finished = false;
  private aborted = false;
  private started = false;
  private renderErrorLogged = false;
  private resolve!: (s: RoundSummary<P, T>) => void;
  private reject!: (e: unknown) => void;

  constructor(cfg: RoundRunnerConfig<P, T>) {
    if (cfg.trials.length === 0) throw new Error(`${cfg.game.id}: 試行が0件のラウンドは実行できません`);
    this.cfg = cfg;
    this.frameMs = cfg.scheduler.frameMs;
    this.params = { ...cfg.params };
    this.layout = cfg.game.responseLayout(this.params, cfg.options);
    this.groups = layoutGroups(this.layout);
    for (const b of this.layout.buttons) this.buttonGroup.set(b.id, b.group ?? 'main');
  }

  get done(): boolean {
    return this.finished || this.aborted;
  }

  /** ラウンドを開始する。全試行を終えると RoundSummary で解決する（abort すると RoundAborted で失敗） */
  start(): Promise<RoundSummary<P, T>> {
    if (this.started) throw new Error('RoundRunner.start() は1回だけ');
    this.started = true;
    const p = new Promise<RoundSummary<P, T>>((res, rej) => {
      this.resolve = res;
      this.reject = rej;
    });
    this.handle = this.cfg.scheduler.requestFrame(this.onFrame);
    return p;
  }

  /** 中断する（ユーザーが試合をやめたとき・画面を離れたとき） */
  abort(): void {
    if (this.done) return;
    this.aborted = true;
    if (!this.started) return;
    if (this.handle !== null) this.cfg.scheduler.cancelFrame(this.handle);
    this.handle = null;
    this.reject(new RoundAborted());
  }

  /**
   * 応答を入れる（ボタンの pointerdown・キー・刺激領域のタップ・テストの自動プレイ）。
   * 受け付けたら true。応答窓の外・応答完成後・未知の id は false（無視）。
   */
  input(id: string, atMs?: number): boolean {
    const s = this.state;
    if (!s || this.done || this.roundStartT === null) return false;
    const ph = s.phases[s.phaseIdx];
    if (!ph || !ph.input || s.complete || s.judgement) return false;
    const group = this.buttonGroup.get(id);
    if (group === undefined) return false;
    const t = Math.max(atMs ?? this.cfg.scheduler.now(), s.phaseStartT);
    s.selection[group] = id;
    this.emitter.emit({ type: 'selection', i: s.i, group, id, atMs: t - this.roundStartT });
    if (this.groups.every((g) => s.selection[g] !== undefined)) {
      s.complete = true;
      s.completeT = t;
      this.judge(t);
    }
    return true;
  }

  /** 提示中の試行データ（刺激領域のタップ判定 hitTest 用） */
  currentTrial(): T | null {
    return this.state && !this.done ? this.state.trial : null;
  }

  /** 現在の状態（テストの自動プレイ用） */
  snapshot(): RunnerSnapshot | null {
    const s = this.state;
    if (!s || this.done) return null;
    const ph = s.phases[s.phaseIdx] as PlannedPhase;
    return {
      kind: this.cfg.options.kind,
      roundNo: this.cfg.options.roundNo,
      trials: this.cfg.trials.length,
      i: s.i,
      phase: ph.name,
      accepting: ph.input && !s.complete && !s.judgement,
      answered: s.complete || s.judgement !== undefined,
      expected: this.cfg.game.expectedResponse(s.trial),
      selection: { ...s.selection },
    };
  }

  // ---------------------------------------------------------------------------

  private readonly onFrame = (t: number): void => {
    this.handle = null;
    if (this.done) return;
    try {
      if (this.roundStartT === null) {
        this.roundStartT = t;
        this.emitter.emit({
          type: 'roundStart',
          kind: this.cfg.options.kind,
          roundNo: this.cfg.options.roundNo,
          trials: this.cfg.trials.length,
          atMs: 0,
        });
        this.beginTrial(0, t);
      } else {
        this.advance(t);
      }
    } catch (err) {
      // ゲーム側（phases / judge / adaptTrial など）の例外: ラウンドを失敗として終わらせる（止まったままにしない）
      this.aborted = true;
      this.state = null;
      this.reject(err);
      return;
    }
    if (this.done) return;
    this.render(t);
    this.handle = this.cfg.scheduler.requestFrame(this.onFrame);
  };

  /** 終わるべきフェーズを終わらせて次へ進める（1フレームで複数進むこともある） */
  private advance(t: number): void {
    for (let guard = 0; guard < 64 && !this.done; guard++) {
      const s = this.state as TrialState<P, T>;
      const ph = s.phases[s.phaseIdx] as PlannedPhase;
      const due = t - s.phaseStartT >= ph.plannedMs - this.frameMs / 2;
      const early = ph.untilResponse && s.complete;
      if (!due && !early) return;
      this.endPhase(t);
    }
  }

  private beginTrial(i: number, t: number): void {
    const { game } = this.cfg;
    const trial = this.cfg.trials[i] as T;
    const specs = game.phases(trial, this.params);
    const phases: PlannedPhase[] = [];
    const seen = new Set<string>();
    for (const sp of specs) {
      if (seen.has(sp.name)) throw new Error(`${game.id}: フェーズ名 ${sp.name} が1試行内で重複しています`);
      seen.add(sp.name);
      const q = quantizeMs(sp.ms, this.frameMs);
      if (q.frames === 0) continue;
      phases.push({
        name: sp.name,
        plannedMs: q.ms,
        frames: q.frames,
        input: sp.input === true,
        untilResponse: sp.untilResponse === true,
      });
    }
    if (phases.length === 0) throw new Error(`${game.id}: 試行 ${i} のフェーズが空です`);
    let anchorIdx = phases.findIndex((p) => p.name === 'stimulus');
    if (anchorIdx < 0) anchorIdx = phases.findIndex((p) => p.input);
    if (anchorIdx < 0) anchorIdx = 0;
    const rel = t - (this.roundStartT as number);
    this.state = {
      i,
      trial,
      params: { ...this.params },
      phases,
      timings: phases.map((p) => ({
        name: p.name,
        plannedMs: p.plannedMs,
        frames: p.frames,
        input: p.input,
        untilResponse: p.untilResponse,
        startMs: rel,
        endMs: rel,
      })),
      phaseIdx: 0,
      phaseStartT: t,
      anchorIdx,
      selection: {},
      complete: false,
    };
    this.emitter.emit({ type: 'trialStart', i, atMs: rel });
    this.startPhase(t);
  }

  private startPhase(t: number): void {
    const s = this.state as TrialState<P, T>;
    const ph = s.phases[s.phaseIdx] as PlannedPhase;
    const rel = t - (this.roundStartT as number);
    s.phaseStartT = t;
    (s.timings[s.phaseIdx] as PhaseTiming).startMs = rel;
    if (s.phaseIdx === s.anchorIdx) s.stimOnsetT = t;
    this.emitter.emit({
      type: 'phase',
      i: s.i,
      phase: ph.name,
      input: ph.input,
      plannedMs: ph.plannedMs,
      atMs: rel,
    });
  }

  private endPhase(t: number): void {
    const s = this.state as TrialState<P, T>;
    const ph = s.phases[s.phaseIdx] as PlannedPhase;
    (s.timings[s.phaseIdx] as PhaseTiming).endMs = t - (this.roundStartT as number);
    const next = s.phases[s.phaseIdx + 1];
    // 応答窓（連続する input フェーズ）が閉じるときに、まだ判定していなければ判定する
    if (ph.input && !(next && next.input) && !s.judgement) this.judge(t);
    if (next) {
      s.phaseIdx += 1;
      this.startPhase(t);
    } else {
      if (!s.judgement) this.judge(t);
      this.finishTrial(t);
    }
  }

  private judge(t: number): void {
    const s = this.state as TrialState<P, T>;
    const { game } = this.cfg;
    const response: Response | null = Object.keys(s.selection).length > 0 ? { ...s.selection } : null;
    const judgement = game.judge(s.trial, response);
    s.judgement = judgement;
    if (judgement.correct) {
      this.combo += 1;
      if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    } else {
      this.combo = 0;
    }
    if (this.cfg.adaptive && game.adaptTrial) {
      this.params = game.adaptTrial(this.params, judgement.correct, judgement);
    }
    // 次の刺激までに残っている予定時間
    const ph = s.phases[s.phaseIdx] as PlannedPhase;
    let remaining = ph.untilResponse && s.complete ? 0 : Math.max(0, s.phaseStartT + ph.plannedMs - t);
    for (let k = s.phaseIdx + 1; k < s.phases.length; k++) remaining += (s.phases[k] as PlannedPhase).plannedMs;
    this.emitter.emit({
      type: 'judged',
      i: s.i,
      correct: judgement.correct,
      ...(judgement.kind !== undefined ? { kind: judgement.kind } : {}),
      combo: this.combo,
      feedbackMaxMs: remaining,
      atMs: t - (this.roundStartT as number),
    });
  }

  private finishTrial(t: number): void {
    const s = this.state as TrialState<P, T>;
    const judgement = s.judgement as Judgement;
    const onsetT = s.stimOnsetT ?? s.phaseStartT;
    const response: Response | null = Object.keys(s.selection).length > 0 ? { ...s.selection } : null;
    const result: TrialResult<P, T> = {
      i: s.i,
      trial: s.trial,
      params: s.params,
      stim: this.cfg.game.describeTrial(s.trial),
      response,
      judgement,
      correct: judgement.correct,
      onsetMs: onsetT - (this.roundStartT as number),
      phases: s.timings,
    };
    if (s.complete && s.completeT !== undefined) result.rtMs = s.completeT - onsetT;
    this.results.push(result);
    if (s.i + 1 < this.cfg.trials.length) {
      this.beginTrial(s.i + 1, t);
    } else {
      this.finish(t);
    }
  }

  private finish(t: number): void {
    this.finished = true;
    this.state = null;
    const results = this.results;
    const correct = results.filter((r) => r.correct).length;
    const errors: Record<string, number> = {};
    for (const r of results) {
      if (r.correct) continue;
      const k = r.judgement.kind ?? 'error';
      errors[k] = (errors[k] ?? 0) + 1;
    }
    const rts = results.filter((r) => r.correct && r.rtMs !== undefined).map((r) => r.rtMs as number);
    const summary: RoundSummary<P, T> = {
      kind: this.cfg.options.kind,
      roundNo: this.cfg.options.roundNo,
      trials: results.length,
      correct,
      accuracy: correct / results.length,
      errors,
      paramsStart: { ...this.cfg.params },
      paramsPlayed: { ...this.params },
      maxCombo: this.maxCombo,
      frameMs: this.frameMs,
      results,
    };
    const rtMedian = median(rts);
    if (rtMedian !== undefined) summary.rtMedianMs = rtMedian;
    this.emitter.emit({
      type: 'roundEnd',
      trials: results.length,
      correct,
      maxCombo: this.maxCombo,
      atMs: t - (this.roundStartT as number),
    });
    // 最後に刺激領域を背景だけにしておく
    this.cfg.surface?.begin();
    this.resolve(summary);
  }

  private render(t: number): void {
    const surface = this.cfg.surface;
    const s = this.state;
    if (!surface || !s) return;
    const target = surface.begin();
    if (!target) return;
    const ph = s.phases[s.phaseIdx] as PlannedPhase;
    const view: RenderView = {
      size: target.size,
      colorSafe: this.cfg.colorSafe === true,
      untrained: this.cfg.options.untrained,
      surface: this.cfg.options.surface,
      selection: { ...s.selection },
    };
    try {
      target.ctx.save();
      this.cfg.game.renderStimulus(target.ctx, s.trial, ph.name, t - s.phaseStartT, view);
    } catch (err) {
      if (!this.renderErrorLogged) {
        this.renderErrorLogged = true;
        console.error(`[brain-fighter] ${this.cfg.game.id}.renderStimulus error`, err);
      }
    } finally {
      target.ctx.restore();
    }
  }
}
