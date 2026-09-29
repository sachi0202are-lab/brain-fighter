/**
 * requestAnimationFrame ベースの提示タイミング。
 *
 * - ミリ秒指定はフレーム数に量子化する（quantizeMs）。量子化後の値を「予定時間」として記録する。
 *   基本は四捨五入で、下限側（33 ms 以下）だけ要求 ms を下回らないように切り上げる。
 * - 実際の提示開始・終了時刻は rAF のタイムスタンプ（performance.now() と同じ時間軸）で記録する。
 * - フレーム間隔は起動時に実測し、標準的なリフレッシュレート（60/120Hz など）に丸める。
 *   丸めることで、同じ端末なら毎回同じ量子化結果になる（演出プリセット間のログ照合が一致する）。
 */

export const DEFAULT_FRAME_MS = 1000 / 60;

/** 丸め先のリフレッシュレート (Hz) */
export const STANDARD_REFRESH_HZ: readonly number[] = [48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 240];

/** 実測したフレーム間隔を、最も近い標準リフレッシュレートのフレーム間隔に丸める */
export function snapFrameMs(measuredMs: number): number {
  if (!Number.isFinite(measuredMs) || measuredMs <= 0) return DEFAULT_FRAME_MS;
  const hz = 1000 / measuredMs;
  let best = 60;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const h of STANDARD_REFRESH_HZ) {
    const err = Math.abs(h - hz) / h;
    if (err < bestErr) {
      best = h;
      bestErr = err;
    }
  }
  return 1000 / best;
}

export interface Quantized {
  /** フレーム数（0 ならそのフェーズは飛ばす） */
  frames: number;
  /** フレーム数 × フレーム間隔 (ms) */
  ms: number;
}

/**
 * 短い提示の下限 (ms)（仕様書 6.1: 提示時間は 33 ms から = 60Hz の 2 フレーム）。
 * 四捨五入だけだと 72/75/100/165Hz で 33 ms が 27〜30 ms で提示されてしまうので、この下限の側だけ切り上げる。
 */
export const MIN_PRESENTATION_MS = 33;

/** 浮動小数の誤差（例: 2 フレーム = 33.333… ms を渡し直す）で切り上げが1フレーム増えないための余裕（フレーム単位） */
const CEIL_EPS = 1e-6;

/**
 * ms をフレーム数に丸める。0 以下は 0 フレーム（そのフェーズは飛ばす）、正の値は最低 1 フレーム。
 * 基本は四捨五入。ただし下限側だけは切り上げて要求を下回らない:
 * 33 ms 未満を求めたらその ms を、33 ms 以上を求めたら 33 ms を下回らない最小のフレーム数より短くしない。
 * （33 ms より長い要求は今までどおり四捨五入なので、例えば 60Hz の 41.25 ms は 2 フレーム = 33.3 ms）
 */
export function quantizeMs(ms: number, frameMs: number): Quantized {
  if (!(ms > 0)) return { frames: 0, ms: 0 };
  const nearest = Math.round(ms / frameMs);
  const lowerGuard = Math.ceil(Math.min(ms, MIN_PRESENTATION_MS) / frameMs - CEIL_EPS);
  const frames = Math.max(1, nearest, lowerGuard);
  return { frames, ms: frames * frameMs };
}

/** 階段法の quantize フックに渡す関数（ms → フレーム単位に丸めた ms） */
export function frameQuantizer(frameMs: number): (ms: number) => number {
  return (ms) => quantizeMs(ms, frameMs).ms;
}

/** ラウンド実行が使う時計とフレーム待ち。ブラウザでは rAF、テストでは仮想時計 */
export interface FrameScheduler {
  /** フレーム間隔 (ms)。量子化に使う */
  readonly frameMs: number;
  now(): number;
  requestFrame(cb: (t: number) => void): number;
  cancelFrame(handle: number): void;
}

export function createRafScheduler(frameMs: number): FrameScheduler {
  return {
    frameMs,
    now: () => performance.now(),
    requestFrame: (cb) => requestAnimationFrame(cb),
    cancelFrame: (h) => cancelAnimationFrame(h),
  };
}

/**
 * rAF の間隔の代表値。フレーム落ちは間隔を長くする方向にしか働かないので、中央値ではなく下位 25% 点を使う
 * （負荷が高くて半分近くのフレームが遅れても、本来のリフレッシュ間隔を拾える）。
 */
export function robustFrameInterval(deltas: readonly number[]): number {
  const sorted = deltas.filter((d) => d > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return DEFAULT_FRAME_MS;
  return sorted[Math.floor(sorted.length * 0.25)] as number;
}

/** rAF の間隔を測り、標準リフレッシュレートに丸めて返す（タブが隠れている等で測れなければ 60Hz） */
export function measureFrameMs(opts: { samples?: number; timeoutMs?: number } = {}): Promise<number> {
  const samples = opts.samples ?? 24;
  const timeoutMs = opts.timeoutMs ?? 1500;
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function') {
      resolve(DEFAULT_FRAME_MS);
      return;
    }
    const deltas: number[] = [];
    let last: number | null = null;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (deltas.length < 4) {
        resolve(DEFAULT_FRAME_MS);
        return;
      }
      resolve(snapFrameMs(robustFrameInterval(deltas)));
    };
    const timer = setTimeout(finish, timeoutMs);
    const step = (t: number): void => {
      if (done) return;
      if (last !== null) deltas.push(t - last);
      last = t;
      if (deltas.length >= samples) finish();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/**
 * テスト用の仮想スケジューラ。step() を呼ぶたびに時刻が1フレーム進み、待っているコールバックが呼ばれる。
 * 時刻は「開始時刻 + フレーム番号 × frameMs」で計算するので誤差が積もらない。
 */
export class VirtualScheduler implements FrameScheduler {
  readonly frameMs: number;
  private readonly start: number;
  private frame = 0;
  private offset = 0;
  private readonly queue = new Map<number, (t: number) => void>();
  private nextHandle = 1;

  constructor(frameMs: number = DEFAULT_FRAME_MS, start = 1000) {
    this.frameMs = frameMs;
    this.start = start;
  }

  now(): number {
    return this.start + this.frame * this.frameMs + this.offset;
  }

  requestFrame(cb: (t: number) => void): number {
    const h = this.nextHandle++;
    this.queue.set(h, cb);
    return h;
  }

  cancelFrame(handle: number): void {
    this.queue.delete(handle);
  }

  /** 待っているコールバックの数 */
  get pending(): number {
    return this.queue.size;
  }

  /** 1フレーム進める */
  step(): void {
    this.frame += 1;
    this.offset = 0;
    const t = this.now();
    const cbs = [...this.queue.values()];
    this.queue.clear();
    for (const cb of cbs) cb(t);
  }

  /** フレームの途中まで時刻だけ進める（入力の時刻をフレームの間に置きたいとき） */
  advanceWithinFrame(ms: number): void {
    this.offset = Math.min(Math.max(0, this.offset + ms), this.frameMs - 1e-6);
  }
}
